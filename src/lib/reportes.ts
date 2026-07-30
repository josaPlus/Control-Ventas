import ExcelJS from 'exceljs';

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

export async function generarReporteMensual(
  filas: FilaReporte[]
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Control de Ventas';
  workbook.created = new Date();

  const hoja = workbook.addWorksheet('Ventas', {
    views: [{ state: 'frozen', ySplit: 1 }],
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

  const filaEncabezado = hoja.getRow(1);
  filaEncabezado.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
    celda.border = BORDE_FINO;
    celda.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  filaEncabezado.height = 22;

  const agregarFilaSubtotal = (etiqueta: string, monto: number) => {
    const fila = hoja.addRow({ comprador: etiqueta, subtotal: monto });
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SUBTOTAL } };
      celda.font = { bold: true };
      celda.border = BORDE_FINO;
    });
    fila.getCell('subtotal').numFmt = '"$"#,##0.00';
  };

  let semanaActual: number | null = null;
  let subtotalSemana = 0;

  for (const fila of filas) {
    const semanaFila = numeroDeSemanaISO(fila.fecha);
    if (semanaActual !== null && semanaFila !== semanaActual) {
      agregarFilaSubtotal(`Subtotal semana ${semanaActual}`, subtotalSemana);
      subtotalSemana = 0;
    }
    semanaActual = semanaFila;
    subtotalSemana += fila.subtotal;

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
  }

  if (semanaActual !== null) {
    agregarFilaSubtotal(`Subtotal semana ${semanaActual}`, subtotalSemana);
  }

  const totalMes = filas.reduce((acc, f) => acc + f.subtotal, 0);
  const filaTotal = hoja.addRow({ comprador: 'TOTAL DEL MES', subtotal: totalMes });
  filaTotal.eachCell({ includeEmpty: true }, (celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOTAL } };
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    celda.border = BORDE_FINO;
  });
  filaTotal.getCell('subtotal').numFmt = '"$"#,##0.00';

  return workbook.xlsx.writeBuffer();
}

// Semana ISO (lunes a domingo) — así el "subtotal semana" agrupa igual
// que en tu bitácora vieja, sin depender de en qué día cae el 1 del mes.
function numeroDeSemanaISO(fechaIso: string): number {
  const fecha = new Date(fechaIso);
  const objetivo = new Date(fecha.valueOf());
  const diaSemana = (fecha.getDay() + 6) % 7;
  objetivo.setDate(objetivo.getDate() - diaSemana + 3);
  const primerJueves = new Date(objetivo.getFullYear(), 0, 4);
  const diferenciaDias = (objetivo.getTime() - primerJueves.getTime()) / 86400000;
  return 1 + Math.round((diferenciaDias - ((primerJueves.getDay() + 6) % 7)) / 7);
}