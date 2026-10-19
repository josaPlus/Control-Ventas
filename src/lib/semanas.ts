// Utilidades de fechas para los reportes. Todo se maneja en horario local:
// `new Date('2026-08-10')` se interpreta como UTC medianoche, que en México
// cae el día anterior por la tarde y correría la semana un día. Por eso
// siempre partimos la cadena a mano en lugar de dársela al constructor.

export function parsearFechaIso(fechaIso: string): Date {
  const [anio, mes, dia] = fechaIso.slice(0, 10).split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

export function formatearFechaIso(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

// Lunes de la semana a la que pertenece la fecha dada.
export function lunesDeLaSemana(fechaIso: string): string {
  const fecha = parsearFechaIso(fechaIso);
  const diaSemana = (fecha.getDay() + 6) % 7; // lunes = 0, domingo = 6
  fecha.setDate(fecha.getDate() - diaSemana);
  return formatearFechaIso(fecha);
}

export function sumarDias(fechaIso: string, dias: number): string {
  const fecha = parsearFechaIso(fechaIso);
  fecha.setDate(fecha.getDate() + dias);
  return formatearFechaIso(fecha);
}

// Semana ISO (lunes a domingo) — así el "subtotal semana" agrupa igual
// que en la bitácora vieja, sin depender de en qué día cae el 1 del mes.
export function numeroDeSemanaIso(fechaIso: string): number {
  const objetivo = parsearFechaIso(fechaIso);
  const diaSemana = (objetivo.getDay() + 6) % 7;
  objetivo.setDate(objetivo.getDate() - diaSemana + 3); // jueves de esa semana
  const primerJueves = new Date(objetivo.getFullYear(), 0, 4);
  const diferenciaDias = (objetivo.getTime() - primerJueves.getTime()) / 86400000;
  return 1 + Math.round((diferenciaDias - ((primerJueves.getDay() + 6) % 7)) / 7);
}

const MESES_CORTOS = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

// "10 ago 2026" — para mostrar el rango en pantalla y en el Excel.
export function formatearFechaLegible(fechaIso: string): string {
  const fecha = parsearFechaIso(fechaIso);
  return `${fecha.getDate()} ${MESES_CORTOS[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

const DIAS = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
];

// "lunes 10 ago 2026" — etiqueta de los subtotales por día.
export function formatearDiaLegible(fechaIso: string): string {
  const fecha = parsearFechaIso(fechaIso);
  return `${DIAS[fecha.getDay()]} ${formatearFechaLegible(fechaIso)}`;
}

export function rangoSemanaLegible(lunesIso: string): string {
  const domingoIso = sumarDias(lunesIso, 6);
  return `${formatearFechaLegible(lunesIso)} al ${formatearFechaLegible(domingoIso)}`;
}
