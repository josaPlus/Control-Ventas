import type { jsPDF } from 'jspdf';
import type { DetalleVenta } from '../types/models';
import type { DatosNegocio, DatosPagare } from '../db/database';
import { formatMoney } from './format';
import { numeroALetras } from './numeroALetras';

export interface DatosNotaRemision {
  negocio: DatosNegocio;
  pagare: DatosPagare;
  /** null = nota en blanco para llenar a mano. */
  numeroNota: number | null;
  fecha: string | null;
  cliente: {
    id?: number;
    comprador: string;
    domicilio: string;
    telefono: string;
  } | null;
  /** Vacío = renglones en blanco. */
  detalles: DetalleVenta[];
  total: number | null;
  tipoDeposito: 'efectivo' | 'deposito' | null;
  pagado: boolean;
  comentario: string | null;
  mostrarTipoHilo: boolean;
}

// Carta vertical. La nota ocupa solo la mitad de arriba para que la de abajo
// sirva para otra nota; de ahí que todo tenga que caber en ALTO_MEDIA_HOJA.
const ANCHO_HOJA = 215.9;
const ALTO_MEDIA_HOJA = 139.7;
const MARGEN = 12;
const ANCHO_UTIL = ANCHO_HOJA - MARGEN * 2; // 191.9 mm
const CENTRO = ANCHO_HOJA / 2;

// Bajó de 8 a 7 renglones para hacerle lugar al pagaré, que ocupa unos 10 mm.
// Medido: con 7 el pagaré termina cerca de 113 mm y la firma va en 130, así que
// aún hay holgura para un beneficiario de nombre largo que gane un renglón.
const RENGLONES_POR_HOJA = 7;
const ALTO_RENGLON = 5.5;

const Y_NEGOCIO = 10;
const Y_DATOS = 20;
const Y_SEPARADOR = 35;
const Y_TABLA = 38;
const ALTO_ENCABEZADO_TABLA = 6.5;
const Y_FIRMA = 130;

const GRIS_LINEA = 150;
// Todo en negro y grises: la nota se imprime, muchas veces en láser B/N, y
// además así se parece al formato de imprenta que ya usan.
const GRIS_ENCABEZADO: [number, number, number] = [234, 234, 234];

interface Columna {
  titulo: string;
  x: number;
  ancho: number;
  alinear: 'left' | 'right';
}

function columnas(mostrarTipoHilo: boolean): Columna[] {
  const anchos: [string, number, 'left' | 'right'][] = mostrarTipoHilo
    ? [
        ['Cantidad', 20, 'right'],
        ['Tipo de hilo', 36, 'left'],
        ['Descripción', 68.9, 'left'],
        ['P/U', 30, 'right'],
        ['Importe', 37, 'right'],
      ]
    : [
        ['Cantidad', 22, 'right'],
        ['Descripción', 102.9, 'left'],
        ['P/U', 30, 'right'],
        ['Importe', 37, 'right'],
      ];

  let x = MARGEN;
  return anchos.map(([titulo, ancho, alinear]) => {
    const col = { titulo, x, ancho, alinear };
    x += ancho;
    return col;
  });
}

function recortar(doc: jsPDF, texto: string, anchoMax: number): string {
  if (doc.getTextWidth(texto) <= anchoMax) return texto;
  let corto = texto;
  while (corto.length > 1 && doc.getTextWidth(corto + '...') > anchoMax) {
    corto = corto.slice(0, -1);
  }
  return corto + '...';
}

function textoEnCelda(doc: jsPDF, valor: string, col: Columna, y: number) {
  const padding = 1.8;
  if (col.alinear === 'right') {
    doc.text(recortar(doc, valor, col.ancho - padding * 2), col.x + col.ancho - padding, y, {
      align: 'right',
    });
  } else {
    doc.text(recortar(doc, valor, col.ancho - padding * 2), col.x + padding, y);
  }
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Suma días naturales a una fecha ISO y devuelve el resultado en ISO. */
export function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  fecha.setDate(fecha.getDate() + dias);
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function dibujarEncabezado(
  doc: jsPDF,
  datos: DatosNotaRemision,
  hoja: number,
  totalHojas: number
) {
  const { negocio, cliente, numeroNota, fecha, pagare } = datos;

  // Nombre del negocio centrado, como en las notas de remisión de imprenta.
  if (negocio.nombre) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0);
    doc.text(recortar(doc, negocio.nombre, ANCHO_UTIL), CENTRO, Y_NEGOCIO, { align: 'center' });

    const contacto = [negocio.domicilio, negocio.telefono && `Tel. ${negocio.telefono}`]
      .filter(Boolean)
      .join('  ·  ');
    if (contacto) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(80);
      doc.text(recortar(doc, contacto, ANCHO_UTIL), CENTRO, Y_NEGOCIO + 4.5, { align: 'center' });
    }
  }

  // ---- Bloque izquierdo: cliente ----
  const relleno = '__________________________________';
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);

  const numeroCliente = cliente?.id != null ? `( ${cliente.id} )  ` : '';
  doc.text(
    recortar(doc, cliente ? `${numeroCliente}${cliente.comprador}` : relleno, 110),
    MARGEN,
    Y_DATOS
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    recortar(doc, `Calle: ${cliente ? cliente.domicilio : relleno}`, 110),
    MARGEN,
    Y_DATOS + 5
  );
  doc.text(
    recortar(doc, `Tel: ${cliente ? cliente.telefono : '________________'}`, 110),
    MARGEN,
    Y_DATOS + 10
  );

  // ---- Bloque derecho: folio, fechas ----
  const etiquetaX = ANCHO_HOJA - MARGEN - 42;
  const valorX = ANCHO_HOJA - MARGEN;
  let y = Y_DATOS - 5;

  const renglones: [string, string][] = [
    ['NO DOCTO.', numeroNota !== null ? `R-${numeroNota}` : '____________'],
    ['Fecha:', fecha ? fechaCorta(fecha) : '____________'],
  ];

  // El vencimiento solo tiene sentido si hay un pagaré que venza.
  if (pagare.activo) {
    const dias = Number(pagare.dias) || 30;
    renglones.push([
      'Vencimiento:',
      fecha ? fechaCorta(sumarDias(fecha, dias)) : '____________',
    ]);
  }

  for (const [etiqueta, valor] of renglones) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(etiqueta, etiquetaX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(valor, valorX, y, { align: 'right' });
    y += 5;
  }

  if (totalHojas > 1) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.text(`Hoja ${hoja} de ${totalHojas}`, valorX, y, { align: 'right' });
  }

  doc.setDrawColor(GRIS_LINEA);
  doc.setLineWidth(0.3);
  doc.line(MARGEN, Y_SEPARADOR, ANCHO_HOJA - MARGEN, Y_SEPARADOR);
}

/** Devuelve la y donde terminó la tabla. */
function dibujarTabla(
  doc: jsPDF,
  cols: Columna[],
  lineas: DetalleVenta[],
  mostrarTipoHilo: boolean
): number {
  doc.setFillColor(...GRIS_ENCABEZADO);
  doc.rect(MARGEN, Y_TABLA, ANCHO_UTIL, ALTO_ENCABEZADO_TABLA, 'F');
  doc.setDrawColor(GRIS_LINEA);
  doc.setLineWidth(0.2);
  doc.rect(MARGEN, Y_TABLA, ANCHO_UTIL, ALTO_ENCABEZADO_TABLA);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(0);
  const yTituloCol = Y_TABLA + ALTO_ENCABEZADO_TABLA - 2.2;
  for (const col of cols) {
    textoEnCelda(doc, col.titulo, col, yTituloCol);
    if (col.x > MARGEN) {
      doc.line(col.x, Y_TABLA, col.x, Y_TABLA + ALTO_ENCABEZADO_TABLA);
    }
  }

  let y = Y_TABLA + ALTO_ENCABEZADO_TABLA;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  for (let i = 0; i < RENGLONES_POR_HOJA; i++) {
    doc.rect(MARGEN, y, ANCHO_UTIL, ALTO_RENGLON);
    for (const col of cols) {
      if (col.x > MARGEN) doc.line(col.x, y, col.x, y + ALTO_RENGLON);
    }

    const linea = lineas[i];
    if (linea) {
      const yTexto = y + ALTO_RENGLON - 1.7;
      const descripcion = `Piñas de hilo color ${linea.color_pina}`;
      const valores = mostrarTipoHilo
        ? [
            String(linea.cantidad_pinas),
            linea.tipo_hilo ?? '',
            descripcion,
            formatMoney(linea.precio_pina),
            formatMoney(linea.subtotal),
          ]
        : [
            String(linea.cantidad_pinas),
            descripcion,
            formatMoney(linea.precio_pina),
            formatMoney(linea.subtotal),
          ];
      valores.forEach((valor, j) => textoEnCelda(doc, valor, cols[j], yTexto));
    }

    y += ALTO_RENGLON;
  }

  return y;
}

/** Totales e importe en letra. Devuelve la y donde terminó. */
function dibujarTotales(
  doc: jsPDF,
  datos: DatosNotaRemision,
  cols: Columna[],
  yTabla: number
): number {
  const ultima = cols[cols.length - 1];
  const unidades = datos.detalles.reduce((acc, d) => acc + d.cantidad_pinas, 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(60);
  doc.text(
    `Total de Unidades: ${datos.detalles.length > 0 ? unidades.toFixed(2) : '________'}`,
    MARGEN,
    yTabla + 5
  );

  const altoTotal = 7;
  doc.setFillColor(...GRIS_ENCABEZADO);
  doc.rect(ultima.x - 30, yTabla + 0.5, 30 + ultima.ancho, altoTotal, 'F');
  doc.setDrawColor(GRIS_LINEA);
  doc.rect(ultima.x - 30, yTabla + 0.5, 30 + ultima.ancho, altoTotal);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(0);
  doc.text('Total', ultima.x - 28, yTabla + altoTotal - 1.5);
  doc.text(
    datos.total !== null ? formatMoney(datos.total) : '____________',
    ultima.x + ultima.ancho - 1.8,
    yTabla + altoTotal - 1.5,
    { align: 'right' }
  );

  let y = yTabla + altoTotal + 6;

  // El importe en letra es lo que impide que alguien altere la cifra.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0);
  const letras =
    datos.total !== null
      ? numeroALetras(datos.total)
      : '__________________________________________________ PESOS ___/100 M.N.';
  doc.text(recortar(doc, letras, ANCHO_UTIL), MARGEN, y);
  y += 4.5;

  if (datos.comentario) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(80);
    doc.text(recortar(doc, `Observaciones: ${datos.comentario}`, ANCHO_UTIL), MARGEN, y);
    y += 4;
  }

  return y;
}

function dibujarPagare(doc: jsPDF, datos: DatosNotaRemision, yInicio: number) {
  const { pagare, fecha, total } = datos;
  const dias = Number(pagare.dias) || 30;
  const vencimiento = fecha ? fechaCorta(sumarDias(fecha, dias)) : '____________';
  const importe = total !== null ? numeroALetras(total) : '____________________';
  const beneficiario = pagare.beneficiario || '____________________';
  const ciudad = pagare.ciudad || '____________';
  const interes = pagare.interes || '5';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(0);
  doc.text('PAGARÉ', MARGEN, yInicio);

  const cuerpo =
    `Debo(emos) y pagaré(mos) a la orden de ${beneficiario} el día ${vencimiento} en la ciudad de ${ciudad} ` +
    `la cantidad de ${importe} Valor recibido a mi (nuestra) entera satisfacción. En caso de no pagarse en la ` +
    `fecha indicada causará un interés moratorio del ${interes}% mensual pagadero conjuntamente con el adeudo ` +
    `principal con su total liquidación. Asimismo me obligo incondicionalmente a pagar el importe de este pagaré ` +
    `y sus accesorios aun y cuando fueran aceptados en mi nombre y representación por empleado o dependiente de ` +
    `mi negocio, conforme al Artículo 11 de la Ley General de Títulos y Operaciones de Crédito.`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.6);
  doc.setTextColor(40);
  const lineas = doc.splitTextToSize(cuerpo, ANCHO_UTIL) as string[];
  doc.text(lineas, MARGEN, yInicio + 3.2);
}

function dibujarFirma(doc: jsPDF, etiqueta: string) {
  doc.setDrawColor(90);
  doc.setLineWidth(0.3);
  doc.line(CENTRO - 35, Y_FIRMA, CENTRO + 35, Y_FIRMA);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(40);
  doc.text(etiqueta, CENTRO, Y_FIRMA + 3.8, { align: 'center' });
}

function dibujarCorte(doc: jsPDF) {
  doc.setDrawColor(GRIS_LINEA);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(0, ALTO_MEDIA_HOJA, ANCHO_HOJA, ALTO_MEDIA_HOJA);
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(140);
  doc.text('corte aquí', MARGEN, ALTO_MEDIA_HOJA - 1.5);
}

// jsPDF se carga aquí y no arriba del archivo: son ~350 KB que no tienen por qué
// pesar en el arranque de la app cuando solo se usan al generar una nota.
export async function generarNotaRemision(datos: DatosNotaRemision): Promise<Uint8Array> {
  const { jsPDF: JsPDF } = await import('jspdf');

  const doc = new JsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const cols = columnas(datos.mostrarTipoHilo);

  // El pagaré es un reconocimiento de deuda: no tiene por qué aparecer en una
  // venta que ya está pagada. La nota en blanco sí lo lleva, porque es la
  // plantilla para una venta a crédito.
  const conPagare = datos.pagare.activo && !datos.pagado;

  const paginas: DetalleVenta[][] = [];
  if (datos.detalles.length === 0) {
    paginas.push([]);
  } else {
    for (let i = 0; i < datos.detalles.length; i += RENGLONES_POR_HOJA) {
      paginas.push(datos.detalles.slice(i, i + RENGLONES_POR_HOJA));
    }
  }

  paginas.forEach((lineas, i) => {
    if (i > 0) doc.addPage('letter', 'portrait');
    const esUltima = i === paginas.length - 1;

    dibujarEncabezado(doc, datos, i + 1, paginas.length);
    const yTabla = dibujarTabla(doc, cols, lineas, datos.mostrarTipoHilo);

    if (esUltima) {
      const yTotales = dibujarTotales(doc, datos, cols, yTabla);
      if (conPagare) {
        dibujarPagare(doc, datos, yTotales + 2);
        dibujarFirma(doc, 'FIRMA DEL DEUDOR');
      } else {
        dibujarFirma(doc, 'Recibí conforme');
      }
    }

    dibujarCorte(doc);
  });

  return new Uint8Array(doc.output('arraybuffer'));
}
