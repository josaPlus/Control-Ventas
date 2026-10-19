import type ExcelJS from 'exceljs';
import { writeFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { ask } from '@tauri-apps/plugin-dialog';
import { obtenerFilasReporteMensual, obtenerFilasReporteSemanal } from '../db/database';
import { generarReporteMensual, generarReporteSemanal } from './reportes';
import { sumarDias, numeroDeSemanaIso } from './semanas';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CARPETA = 'Control de Ventas/Save';

export interface ResultadoExportacion {
  exportado: boolean;
  ruta: string;
}

// Escribe el buffer preguntando antes si ya había un archivo con ese nombre.
async function guardarSiSeConfirma(
  nombreArchivo: string,
  descripcion: string,
  generar: () => Promise<ExcelJS.Buffer>
): Promise<ResultadoExportacion> {
  const rutaRelativa = `${CARPETA}/${nombreArchivo}`;

  const yaExiste = await exists(rutaRelativa, { baseDir: BaseDirectory.Document });
  if (yaExiste) {
    const reemplazar = await ask(
      `Ya existe un reporte de ${descripcion}. ¿Quieres reemplazarlo?`,
      { title: 'Archivo existente', kind: 'warning' }
    );
    if (!reemplazar) {
      return { exportado: false, ruta: rutaRelativa };
    }
  }

  const buffer = await generar();
  await writeFile(rutaRelativa, new Uint8Array(buffer as ArrayBuffer), {
    baseDir: BaseDirectory.Document,
  });

  return { exportado: true, ruta: rutaRelativa };
}

// anio: 2026, mes: 1-12
export async function exportarReporteMensual(
  anio: number,
  mes: number
): Promise<ResultadoExportacion> {
  const filas = await obtenerFilasReporteMensual(anio, mes);

  return guardarSiSeConfirma(
    `Control-Ventas_${MESES[mes - 1]}-${anio}.xlsx`,
    `${MESES[mes - 1]} ${anio}`,
    () => generarReporteMensual(filas)
  );
}

// lunesIso: lunes de la semana, 'YYYY-MM-DD'. El nombre lleva las fechas de
// inicio y fin para que se distinga de un vistazo en la carpeta.
export async function exportarReporteSemanal(
  lunesIso: string
): Promise<ResultadoExportacion> {
  const filas = await obtenerFilasReporteSemanal(lunesIso);
  const domingoIso = sumarDias(lunesIso, 6);
  const semana = String(numeroDeSemanaIso(lunesIso)).padStart(2, '0');

  return guardarSiSeConfirma(
    `Control-Ventas_Semana-${semana}_${lunesIso}_a_${domingoIso}.xlsx`,
    `la semana del ${lunesIso} al ${domingoIso}`,
    () => generarReporteSemanal(filas, lunesIso)
  );
}
