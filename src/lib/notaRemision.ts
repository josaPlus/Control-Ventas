import type { jsPDF } from 'jspdf';
import type { DetalleVenta } from '../types/models';
import type { DatosNegocio } from '../db/database';
import { formatMoney, formatDateLong } from './format';

export interface DatosNotaRemision {
  negocio: DatosNegocio;
  /** null = nota en blanco para llenar a mano. */
  numeroNota: number | null;
  fecha: string | null;
  cliente: { comprador: string; domicilio: string; telefono: string } | null;
  /** Vacío = renglones en blanco. */
  detalles: DetalleVenta[];
  total: number | null;
  tipoDeposito: 'efectivo' | 'deposito' | null;
  comentario: string | null;
  mostrarTipoHilo: boolean;
}

// Carta vertical. La nota ocupa solo la mitad de arriba para que la de abajo
// sirva para otra nota; de ahí que todo tenga que caber en ALTO_MEDIA_HOJA.
const ANCHO_HOJA = 215.9;
const ALTO_MEDIA_HOJA = 139.7;
const MARGEN = 12;
const ANCHO_UTIL = ANCHO_HOJA - MARGEN * 2; // 191.9 mm

const RENGLONES_POR_HOJA = 8;
const ALTO_RENGLON = 6;

// Coordenadas verticales de cada bloque. Están juntas a propósito: mover un
// bloque obliga a ver de dónde se le quita el espacio.
const Y_NEGOCIO = 16;
const Y_SEPARADOR = 29;
const Y_CLIENTE = 35;
const Y_TABLA = 52;
const ALTO_ENCABEZADO_TABLA = 7;
const Y_FIRMA = 130;

const GRIS_LINEA = 150;
// Tupla y no un solo valor: los tipos de jsPDF no exponen el atajo de escala de
// grises para setFillColor, solo la variante de tres componentes.
const GRIS_ENCABEZADO: [number, number, number] = [234, 234, 234];
const ACENTO: [number, number, number] = [58, 91, 217]; // #3A5BD9, el de la app

interface Columna {
  titulo: string;
  x: number;
  ancho: number;
  alinear: 'left' | 'right';
}

// Los anchos suman ANCHO_UTIL exacto. Con tipo de hilo, el color cede espacio.
function columnas(mostrarTipoHilo: boolean): Columna[] {
  const anchos: [string, number, 'left' | 'right'][] = mostrarTipoHilo
    ? [
        ['Cant.', 18, 'right'],
        ['Tipo de hilo', 34, 'left'],
        ['Color', 72.9, 'left'],
        ['P. unitario', 32, 'right'],
        ['Importe', 35, 'right'],
      ]
    : [
        ['Cant.', 20, 'right'],
        ['Color del hilo', 104.9, 'left'],
        ['P. unitario', 32, 'right'],
        ['Importe', 35, 'right'],
      ];

  let x = MARGEN;
  return anchos.map(([titulo, ancho, alinear]) => {
    const col = { titulo, x, ancho, alinear };
    x += ancho;
    return col;
  });
}

// Recorta el texto que no quepa en su celda. Sin esto, un color con nombre
// largo se derramaría encima de la columna siguiente.
function recortar(doc: jsPDF, texto: string, anchoMax: number): string {
  if (doc.getTextWidth(texto) <= anchoMax) return texto;
  let corto = texto;
  while (corto.length > 1 && doc.getTextWidth(corto + '...') > anchoMax) {
    corto = corto.slice(0, -1);
  }
  return corto + '...';
}

function lineaPunteada(doc: jsPDF, y: number) {
  doc.setDrawColor(GRIS_LINEA);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(0, y, ANCHO_HOJA, y);
  doc.setLineDashPattern([], 0);
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

/** Bloque del emisor, título y folio. Devuelve nada: escribe en posiciones fijas. */
function dibujarEncabezado(
  doc: jsPDF,
  datos: DatosNotaRemision,
  hoja: number,
  totalHojas: number
) {
  const { negocio, numeroNota } = datos;

  // Si no hay nombre de negocio capturado, se omite el bloque entero en vez de
  // dejar un hueco o un texto de relleno.
  if (negocio.nombre) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0);
    doc.text(recortar(doc, negocio.nombre, 120), MARGEN, Y_NEGOCIO);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(70);
    let y = Y_NEGOCIO + 4.5;
    if (negocio.domicilio) {
      doc.text(recortar(doc, negocio.domicilio, 120), MARGEN, y);
      y += 4;
    }
    if (negocio.telefono) {
      doc.text(`Tel. ${negocio.telefono}`, MARGEN, y);
    }
  }

  const derecha = ANCHO_HOJA - MARGEN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ACENTO);
  doc.text('NOTA DE REMISIÓN', derecha, Y_NEGOCIO, { align: 'right' });

  doc.setFontSize(10);
  doc.setTextColor(0);
  const folio = numeroNota !== null ? `N° ${numeroNota}` : 'N° ________';
  doc.text(folio, derecha, Y_NEGOCIO + 5.5, { align: 'right' });

  if (totalHojas > 1) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(`Hoja ${hoja} de ${totalHojas}`, derecha, Y_NEGOCIO + 10, { align: 'right' });
  }

  doc.setDrawColor(GRIS_LINEA);
  doc.setLineWidth(0.3);
  doc.line(MARGEN, Y_SEPARADOR, ANCHO_HOJA - MARGEN, Y_SEPARADOR);
}

function dibujarCliente(doc: jsPDF, datos: DatosNotaRemision) {
  const { cliente, fecha, tipoDeposito } = datos;
  const enBlanco = cliente === null;
  const relleno = '______________________________';

  const filas: [string, string][] = [
    ['Cliente:', enBlanco ? relleno : cliente.comprador],
    ['Domicilio:', enBlanco ? relleno : cliente.domicilio],
    ['Teléfono:', enBlanco ? relleno : cliente.telefono],
  ];

  let y = Y_CLIENTE;
  for (const [etiqueta, valor] of filas) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text(etiqueta, MARGEN, y);

    doc.setFont('helvetica', 'normal');
    doc.text(recortar(doc, valor, 95), MARGEN + 20, y);
    y += 5.5;
  }

  // Columna derecha: fecha y forma de pago.
  const derecha = ANCHO_HOJA - MARGEN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Fecha:', derecha - 40, Y_CLIENTE);
  doc.setFont('helvetica', 'normal');
  doc.text(fecha ? formatDateLong(fecha) : '____________', derecha, Y_CLIENTE, {
    align: 'right',
  });

  doc.setFont('helvetica', 'bold');
  doc.text('Pago:', derecha - 40, Y_CLIENTE + 5.5);
  doc.setFont('helvetica', 'normal');
  const pago =
    tipoDeposito === null
      ? '____________'
      : tipoDeposito === 'efectivo'
        ? 'Efectivo'
        : 'Depósito';
  doc.text(pago, derecha, Y_CLIENTE + 5.5, { align: 'right' });
}

/** Devuelve la y donde terminó la tabla. */
function dibujarTabla(
  doc: jsPDF,
  cols: Columna[],
  lineas: DetalleVenta[],
  mostrarTipoHilo: boolean
): number {
  // Encabezado con fondo gris: es más barato de imprimir que un color sólido.
  doc.setFillColor(...GRIS_ENCABEZADO);
  doc.rect(MARGEN, Y_TABLA, ANCHO_UTIL, ALTO_ENCABEZADO_TABLA, 'F');
  doc.setDrawColor(GRIS_LINEA);
  doc.setLineWidth(0.2);
  doc.rect(MARGEN, Y_TABLA, ANCHO_UTIL, ALTO_ENCABEZADO_TABLA);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0);
  const yTituloCol = Y_TABLA + ALTO_ENCABEZADO_TABLA - 2.4;
  for (const col of cols) {
    textoEnCelda(doc, col.titulo, col, yTituloCol);
    if (col.x > MARGEN) {
      doc.line(col.x, Y_TABLA, col.x, Y_TABLA + ALTO_ENCABEZADO_TABLA);
    }
  }

  // Siempre se dibujan RENGLONES_POR_HOJA marcos: en una nota en blanco son los
  // renglones para escribir, y en una con pocas líneas dan cuerpo a la tabla.
  let y = Y_TABLA + ALTO_ENCABEZADO_TABLA;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  for (let i = 0; i < RENGLONES_POR_HOJA; i++) {
    doc.rect(MARGEN, y, ANCHO_UTIL, ALTO_RENGLON);
    for (const col of cols) {
      if (col.x > MARGEN) doc.line(col.x, y, col.x, y + ALTO_RENGLON);
    }

    const linea = lineas[i];
    if (linea) {
      const yTexto = y + ALTO_RENGLON - 1.9;
      const valores = mostrarTipoHilo
        ? [
            String(linea.cantidad_pinas),
            linea.tipo_hilo ?? '',
            linea.color_pina,
            formatMoney(linea.precio_pina),
            formatMoney(linea.subtotal),
          ]
        : [
            String(linea.cantidad_pinas),
            linea.color_pina,
            formatMoney(linea.precio_pina),
            formatMoney(linea.subtotal),
          ];
      valores.forEach((valor, j) => textoEnCelda(doc, valor, cols[j], yTexto));
    }

    y += ALTO_RENGLON;
  }

  return y;
}

function dibujarPie(
  doc: jsPDF,
  datos: DatosNotaRemision,
  cols: Columna[],
  yTabla: number,
  esUltimaHoja: boolean
) {
  const ultima = cols[cols.length - 1];

  if (esUltimaHoja) {
    const altoTotal = 7.5;
    doc.setFillColor(...GRIS_ENCABEZADO);
    doc.rect(ultima.x - 32, yTabla, 32 + ultima.ancho, altoTotal, 'F');
    doc.setDrawColor(GRIS_LINEA);
    doc.rect(ultima.x - 32, yTabla, 32 + ultima.ancho, altoTotal);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0);
    doc.text('TOTAL', ultima.x - 30, yTabla + altoTotal - 2.5);
    doc.text(
      datos.total !== null ? formatMoney(datos.total) : '____________',
      ultima.x + ultima.ancho - 1.8,
      yTabla + altoTotal - 2.5,
      { align: 'right' }
    );

    if (datos.comentario) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(70);
      doc.text(
        recortar(doc, `Observaciones: ${datos.comentario}`, ANCHO_UTIL),
        MARGEN,
        yTabla + altoTotal + 5
      );
    }
  }

  // Firma de quien recibe: es lo que convierte el papel en acuse de entrega.
  doc.setDrawColor(120);
  doc.setLineWidth(0.3);
  doc.line(ANCHO_HOJA - MARGEN - 62, Y_FIRMA, ANCHO_HOJA - MARGEN, Y_FIRMA);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(70);
  doc.text('Recibí conforme', ANCHO_HOJA - MARGEN - 31, Y_FIRMA + 4, { align: 'center' });

  lineaPunteada(doc, ALTO_MEDIA_HOJA);
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

  // Una venta con muchas líneas se reparte en varias hojas en vez de comprimir
  // renglones o truncar líneas. Cada hoja respeta la regla de la media hoja.
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
    dibujarCliente(doc, datos);
    const yTabla = dibujarTabla(doc, cols, lineas, datos.mostrarTipoHilo);
    dibujarPie(doc, datos, cols, yTabla, esUltima);
  });

  return new Uint8Array(doc.output('arraybuffer'));
}
