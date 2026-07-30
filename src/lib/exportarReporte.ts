import { writeFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { ask } from '@tauri-apps/plugin-dialog';
import { obtenerFilasReporteMensual } from '../db/database';
import { generarReporteMensual } from './reportes';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// anio: 2026, mes: 1-12
export async function exportarReporteMensual(
  anio: number,
  mes: number
): Promise<{ exportado: boolean; ruta: string }> {
  const filas = await obtenerFilasReporteMensual(anio, mes);

  const nombreArchivo = `Control-Ventas_${MESES[mes - 1]}-${anio}.xlsx`;
  const rutaRelativa = `Control de Ventas/Save/${nombreArchivo}`;

  const yaExiste = await exists(rutaRelativa, { baseDir: BaseDirectory.Document });
  if (yaExiste) {
    const reemplazar = await ask(
      `Ya existe un reporte de ${MESES[mes - 1]} ${anio}. ¿Quieres reemplazarlo?`,
      { title: 'Archivo existente', kind: 'warning' }
    );
    if (!reemplazar) {
      return { exportado: false, ruta: rutaRelativa };
    }
  }

  const buffer = await generarReporteMensual(filas);
  await writeFile(rutaRelativa, new Uint8Array(buffer), {
    baseDir: BaseDirectory.Document,
  });

  return { exportado: true, ruta: rutaRelativa };
}