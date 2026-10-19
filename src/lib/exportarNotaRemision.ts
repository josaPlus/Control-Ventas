import { writeFile, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { ask } from '@tauri-apps/plugin-dialog';
import {
  obtenerNotaCompleta,
  leerDatosNegocio,
  leerDatosPagare,
  leerLogoNegocio,
} from '../db/database';
import { generarNotaRemision } from './notaRemision';

const CARPETA = 'Control de Ventas/Save/Notas';
// Una carpeta por cliente: con muchas ventas, una sola carpeta con todas las
// notas mezcladas se vuelve imposible de revisar.
const CARPETA_CLIENTES = `${CARPETA}/Clientes`;

export interface NotaExportada {
  exportado: boolean;
  /** Ruta del PDF, relativa a Documentos. */
  ruta: string;
  /** Carpeta donde quedó, relativa a Documentos. */
  carpeta: string;
}

// Windows prohíbe estos caracteres en nombres de archivo. Los acentos NO se
// tocan: NTFS los admite y el objetivo es que el usuario encuentre el archivo
// de "José Martínez" buscando su nombre tal como lo escribió.
const PROHIBIDOS = /[\\/:*?"<>|\x00-\x1f]/g;

// Nombres reservados de MS-DOS que Windows sigue rechazando como nombre de
// archivo, incluso con extensión.
const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function nombreArchivoSeguro(texto: string): string {
  let limpio = texto
    .replace(PROHIBIDOS, '-')
    .replace(/[-\s]+/g, ' ')
    .trim()
    // Windows no admite nombres terminados en punto ni en espacio.
    .replace(/[.\s]+$/, '');

  if (limpio.length > 60) limpio = limpio.slice(0, 60).trim();
  if (!limpio || RESERVADOS.test(limpio)) return 'Cliente';
  return limpio;
}

/** "Control de Ventas/Save/Notas" → "Documentos / Control de Ventas / Save / Notas". */
export function carpetaLegible(carpeta: string): string {
  return ['Documentos', ...carpeta.split('/')].join(' / ');
}

// Lleva el número de cliente además del nombre: dos clientes que se llamen
// igual no deben compartir carpeta, y es el mismo número que sale en la nota
// junto al nombre, así que se reconoce. Si al cliente le cambian el nombre,
// sus notas nuevas irán a otra carpeta; se acepta porque buscar a alguien
// solo por número sería mucho peor.
function carpetaDelCliente(cliente: { id?: number; comprador: string }): string {
  const nombre = nombreArchivoSeguro(cliente.comprador);
  const carpeta = cliente.id != null ? `${nombre} (${cliente.id})` : nombre;
  return `${CARPETA_CLIENTES}/${carpeta}`;
}

async function asegurarCarpeta(carpeta: string) {
  // La carpeta Save la crea Rust al arrancar; las de abajo se crean aquí la
  // primera vez que hacen falta. El permiso fs:allow-document-write-recursive
  // incluye mkdir, y recursive crea de una vez Notas, Clientes y la del cliente.
  await mkdir(carpeta, { baseDir: BaseDirectory.Document, recursive: true });
}

async function guardar(
  carpeta: string,
  nombreArchivo: string,
  pdf: Uint8Array,
  preguntarSiExiste: boolean
): Promise<NotaExportada> {
  await asegurarCarpeta(carpeta);
  const ruta = `${carpeta}/${nombreArchivo}`;

  if (preguntarSiExiste && (await exists(ruta, { baseDir: BaseDirectory.Document }))) {
    const reemplazar = await ask(`Ya existe "${nombreArchivo}". ¿Quieres reemplazarlo?`, {
      title: 'Archivo existente',
      kind: 'warning',
    });
    if (!reemplazar) return { exportado: false, ruta, carpeta };
  }

  await writeFile(ruta, pdf, { baseDir: BaseDirectory.Document });
  return { exportado: true, ruta, carpeta };
}

export async function exportarNotaDeVenta(
  notaVentaId: number,
  manejaTipos: boolean
): Promise<NotaExportada> {
  const nota = await obtenerNotaCompleta(notaVentaId);
  if (!nota) throw new Error('La venta ya no existe.');

  const [negocio, pagare, logo] = await Promise.all([
    leerDatosNegocio(),
    leerDatosPagare(),
    leerLogoNegocio(),
  ]);

  // Misma regla que usa el detalle del historial: la columna aparece si el
  // negocio maneja tipos o si esta venta en concreto ya trae alguno.
  const mostrarTipoHilo =
    manejaTipos || nota.detalles.some((d) => d.tipo_hilo?.trim());

  const pdf = await generarNotaRemision({
    negocio,
    pagare,
    numeroNota: nota.numero_nota,
    fecha: nota.fecha,
    cliente: nota.cliente,
    detalles: nota.detalles,
    total: nota.total_venta,
    tipoDeposito: nota.tipo_deposito,
    pagado: nota.pagado,
    comentario: nota.comentario ?? null,
    mostrarTipoHilo,
    logo,
  });

  // El número va primero para que dentro de la carpeta del cliente queden en
  // orden. El nombre se conserva porque el PDF suele mandarse por WhatsApp o
  // correo, y fuera de su carpeta tiene que seguir diciendo de quién es.
  const nombre = `Nota-${nota.numero_nota}-${nombreArchivoSeguro(nota.cliente.comprador)}.pdf`;
  return await guardar(carpetaDelCliente(nota.cliente), nombre, pdf, true);
}

export async function exportarNotaEnBlanco(manejaTipos: boolean): Promise<NotaExportada> {
  const [negocio, pagare, logo] = await Promise.all([
    leerDatosNegocio(),
    leerDatosPagare(),
    leerLogoNegocio(),
  ]);

  const pdf = await generarNotaRemision({
    negocio,
    pagare,
    numeroNota: null,
    fecha: null,
    cliente: null,
    detalles: [],
    total: null,
    tipoDeposito: null,
    // La plantilla en blanco es para una venta a crédito, así que lleva pagaré.
    pagado: false,
    comentario: null,
    mostrarTipoHilo: manejaTipos,
    logo,
  });

  // Se sobrescribe sin preguntar: es una plantilla idéntica cada vez, no hay
  // nada que perder y preguntarlo en cada generación sería puro estorbo.
  // No es de ningún cliente, así que se queda en Notas, a la vista.
  return await guardar(CARPETA, 'Nota-en-blanco.pdf', pdf, false);
}
