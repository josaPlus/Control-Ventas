import { writeFile, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { ask } from '@tauri-apps/plugin-dialog';
import { obtenerNotaCompleta, leerDatosNegocio } from '../db/database';
import { generarNotaRemision } from './notaRemision';

const CARPETA = 'Control de Ventas/Save/Notas';

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

async function asegurarCarpeta() {
  // La carpeta Save la crea Rust al arrancar, pero la subcarpeta Notas es nueva.
  // El permiso fs:allow-document-write-recursive incluye mkdir.
  await mkdir(CARPETA, { baseDir: BaseDirectory.Document, recursive: true });
}

async function guardar(
  nombreArchivo: string,
  pdf: Uint8Array,
  preguntarSiExiste: boolean
): Promise<{ exportado: boolean; ruta: string }> {
  const ruta = `${CARPETA}/${nombreArchivo}`;

  if (preguntarSiExiste && (await exists(ruta, { baseDir: BaseDirectory.Document }))) {
    const reemplazar = await ask(`Ya existe "${nombreArchivo}". ¿Quieres reemplazarlo?`, {
      title: 'Archivo existente',
      kind: 'warning',
    });
    if (!reemplazar) return { exportado: false, ruta };
  }

  await writeFile(ruta, pdf, { baseDir: BaseDirectory.Document });
  return { exportado: true, ruta };
}

export async function exportarNotaDeVenta(
  notaVentaId: number,
  manejaTipos: boolean
): Promise<{ exportado: boolean; ruta: string }> {
  const nota = await obtenerNotaCompleta(notaVentaId);
  if (!nota) throw new Error('La venta ya no existe.');

  const negocio = await leerDatosNegocio();
  await asegurarCarpeta();

  // Misma regla que usa el detalle del historial: la columna aparece si el
  // negocio maneja tipos o si esta venta en concreto ya trae alguno.
  const mostrarTipoHilo =
    manejaTipos || nota.detalles.some((d) => d.tipo_hilo?.trim());

  const pdf = await generarNotaRemision({
    negocio,
    numeroNota: nota.numero_nota,
    fecha: nota.fecha,
    cliente: nota.cliente,
    detalles: nota.detalles,
    total: nota.total_venta,
    tipoDeposito: nota.tipo_deposito,
    comentario: nota.comentario ?? null,
    mostrarTipoHilo,
  });

  const nombre = `Nota-${nombreArchivoSeguro(nota.cliente.comprador)}-${nota.numero_nota}.pdf`;
  return await guardar(nombre, pdf, true);
}

export async function exportarNotaEnBlanco(
  manejaTipos: boolean
): Promise<{ exportado: boolean; ruta: string }> {
  const negocio = await leerDatosNegocio();
  await asegurarCarpeta();

  const pdf = await generarNotaRemision({
    negocio,
    numeroNota: null,
    fecha: null,
    cliente: null,
    detalles: [],
    total: null,
    tipoDeposito: null,
    comentario: null,
    mostrarTipoHilo: manejaTipos,
  });

  // Se sobrescribe sin preguntar: es una plantilla idéntica cada vez, no hay
  // nada que perder y preguntarlo en cada generación sería puro estorbo.
  return await guardar('Nota-en-blanco.pdf', pdf, false);
}
