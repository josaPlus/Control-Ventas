import ExcelJS from 'exceljs';
import { formatearDiaLegible, numeroDeSemanaIso, rangoSemanaLegible } from './semanas';

export interface FilaReporte {
  numeroNota: number;
  fecha: string;
  comprador: string;
  domicilio: string;
  telefono: string;
  colorPina: string;
  tipoHilo: string | null;
  cantidadPinas: number;
  precioPina: number;
  subtotal: number;
  tipoDeposito: string;
  pagado: boolean;
  comentario: string | null;
}

const COLOR_ENCABEZADO = 'FF3A5BD9';
const COLOR_SUBTOTAL = 'FFEAEEFB';
const COLOR_TOTAL = 'FF2C46AD';
const BORDE_FINO = {
  top: { style: 'thin' as const, color: { argb: 'FFC3C2B7' } },
  left: { style: 'thin' as const, color: { argb: 'FFC3C2B7' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFC3C2B7' } },
  right: { style: 'thin' as const, color: { argb: 'FFC3C2B7' } },
};

// Crea el libro con la hoja ya formateada (título opcional + encabezados) y
// devuelve todo lo que los reportes necesitan para seguir escribiendo filas.
function crearLibro(titulo?: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Control de Ventas';
  workbook.created = new Date();

  const filasFijas = titulo ? 2 : 1;
  const hoja = workbook.addWorksheet('Ventas', {
    views: [{ state: 'frozen', ySplit: filasFijas }],
  });

  hoja.columns = [
    { header: 'ID (Núm. Nota)', key: 'numeroNota', width: 12 },
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Comprador', key: 'comprador', width: 24 },
    { header: 'Domicilio', key: 'domicilio', width: 24 },
    { header: 'Teléfono', key: 'telefono', width: 14 },
    { header: 'Color de piña', key: 'colorPina', width: 16 },
    { header: 'Tipo de hilo', key: 'tipoHilo', width: 14 },
    { header: 'Cantidad', key: 'cantidadPinas', width: 12 },
    { header: 'Precio por piña', key: 'precioPina', width: 14 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Depósito/Efectivo', key: 'tipoDeposito', width: 16 },
    { header: 'Pagado', key: 'pagado', width: 10 },
    { header: 'Comentario', key: 'comentario', width: 24 },
  ];

  // Al declarar `columns` ExcelJS ya escribió los encabezados en la fila 1.
  // Si hay título, se inserta una fila arriba y los encabezados bajan a la 2.
  if (titulo) {
    hoja.spliceRows(1, 0, []);
    const filaTitulo = hoja.getRow(1);
    hoja.mergeCells(1, 1, 1, hoja.columnCount);
    filaTitulo.getCell(1).value = titulo;
    filaTitulo.getCell(1).font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    filaTitulo.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLOR_TOTAL },
    };
    filaTitulo.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    filaTitulo.height = 26;
  }

  const filaEncabezado = hoja.getRow(filasFijas);
  filaEncabezado.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
    celda.border = BORDE_FINO;
    celda.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  filaEncabezado.height = 22;

  const agregarFilaVenta = (fila: FilaReporte) => {
    const filaExcel = hoja.addRow({
      numeroNota: fila.numeroNota,
      fecha: fila.fecha,
      comprador: fila.comprador,
      domicilio: fila.domicilio,
      telefono: fila.telefono,
      colorPina: fila.colorPina,
      tipoHilo: fila.tipoHilo ?? '',
      cantidadPinas: fila.cantidadPinas,
      precioPina: fila.precioPina,
      subtotal: fila.subtotal,
      tipoDeposito: fila.tipoDeposito,
      pagado: fila.pagado ? 'Sí' : 'No',
      comentario: fila.comentario ?? '',
    });

    filaExcel.eachCell({ includeEmpty: true }, (celda) => {
      celda.border = BORDE_FINO;
    });
    filaExcel.getCell('precioPina').numFmt = '"$"#,##0.00';
    filaExcel.getCell('subtotal').numFmt = '"$"#,##0.00';
  };

  const agregarFilaSubtotal = (etiqueta: string, monto: number) => {
    const fila = hoja.addRow({ comprador: etiqueta, subtotal: monto });
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SUBTOTAL } };
      celda.font = { bold: true };
      celda.border = BORDE_FINO;
    });
    fila.getCell('subtotal').numFmt = '"$"#,##0.00';
  };

  const agregarFilaTotal = (etiqueta: string, monto: number) => {
    const fila = hoja.addRow({ comprador: etiqueta, subtotal: monto });
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOTAL } };
      celda.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
      celda.border = BORDE_FINO;
    });
    fila.getCell('subtotal').numFmt = '"$"#,##0.00';
  };

  return { workbook, agregarFilaVenta, agregarFilaSubtotal, agregarFilaTotal };
}

const sumarSubtotales = (filas: FilaReporte[]) =>
  filas.reduce((acc, f) => acc + f.subtotal, 0);

export async function generarReporteMensual(
  filas: FilaReporte[]
): Promise<ExcelJS.Buffer> {
  const { workbook, agregarFilaVenta, agregarFilaSubtotal, agregarFilaTotal } =
    crearLibro();

  let semanaActual: number | null = null;
  let subtotalSemana = 0;

  for (const fila of filas) {
    const semanaFila = numeroDeSemanaIso(fila.fecha);
    if (semanaActual !== null && semanaFila !== semanaActual) {
      agregarFilaSubtotal(`Subtotal semana ${semanaActual}`, subtotalSemana);
      subtotalSemana = 0;
    }
    semanaActual = semanaFila;
    subtotalSemana += fila.subtotal;

    agregarFilaVenta(fila);
  }

  if (semanaActual !== null) {
    agregarFilaSubtotal(`Subtotal semana ${semanaActual}`, subtotalSemana);
  }

  agregarFilaTotal('TOTAL DEL MES', sumarSubtotales(filas));

  return workbook.xlsx.writeBuffer();
}

// lunesIso: lunes de la semana reportada. Aquí no hay subtotales semanales
// (sería un solo bloque repetido); en su lugar se corta por día, que es el
// detalle útil cuando el reporte cubre una sola semana.
export async function generarReporteSemanal(
  filas: FilaReporte[],
  lunesIso: string
): Promise<ExcelJS.Buffer> {
  const titulo = `Semana ${numeroDeSemanaIso(lunesIso)} — ${rangoSemanaLegible(lunesIso)}`;
  const { workbook, agregarFilaVenta, agregarFilaSubtotal, agregarFilaTotal } =
    crearLibro(titulo);

  let diaActual: string | null = null;
  let subtotalDia = 0;

  for (const fila of filas) {
    const diaFila = fila.fecha.slice(0, 10);
    if (diaActual !== null && diaFila !== diaActual) {
      agregarFilaSubtotal(`Subtotal ${formatearDiaLegible(diaActual)}`, subtotalDia);
      subtotalDia = 0;
    }
    diaActual = diaFila;
    subtotalDia += fila.subtotal;

    agregarFilaVenta(fila);
  }

  if (diaActual !== null) {
    agregarFilaSubtotal(`Subtotal ${formatearDiaLegible(diaActual)}`, subtotalDia);
  }

  agregarFilaTotal('TOTAL DE LA SEMANA', sumarSubtotales(filas));

  return workbook.xlsx.writeBuffer();
}