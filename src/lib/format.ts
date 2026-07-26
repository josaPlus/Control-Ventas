// Helpers de formato compartidos por toda la UI (moneda, fecha, teléfono)

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export function formatMoney(amount: number): string {
  return currencyFormatter.format(amount ?? 0);
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function daysAgoIso(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

// toISOString() trabaja en UTC; restar el offset evita que una fecha local se
// convierta en la del día anterior.
function aIsoLocal(fecha: Date): string {
  const offset = fecha.getTimezoneOffset();
  return new Date(fecha.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

/** Primer día del mes. offsetMeses = -1 devuelve el del mes pasado. */
export function inicioDeMesIso(offsetMeses = 0): string {
  const now = new Date();
  return aIsoLocal(new Date(now.getFullYear(), now.getMonth() + offsetMeses, 1));
}

/**
 * El mismo día del mes pasado que hoy, para comparar periodos parejos: no
 * tiene sentido medir 26 días de este mes contra los 31 del anterior.
 * Si el día no existe (31 de marzo → febrero), se recorta al último día.
 */
export function mismoDiaMesAnteriorIso(): string {
  const now = new Date();
  // El día 0 del mes actual es el último día del mes anterior.
  const ultimoDiaMesAnterior = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const dia = Math.min(now.getDate(), ultimoDiaMesAnterior);
  return aIsoLocal(new Date(now.getFullYear(), now.getMonth() - 1, dia));
}

/** Los últimos N meses en formato "YYYY-MM", del más viejo al más reciente. */
export function mesesRecientes(cantidad: number): string[] {
  const now = new Date();
  const meses: string[] = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    meses.push(aIsoLocal(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7));
  }
  return meses;
}

export function formatMesCorto(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "numeric" });
}

/** "+12.5 %" / "-8.3 %". Se usa en las tarjetas de crecimiento. */
export function formatPorcentaje(valor: number): string {
  const signo = valor > 0 ? "+" : "";
  return `${signo}${valor.toFixed(1)} %`;
}

export function formatPinas(cantidad: number): string {
  return new Intl.NumberFormat("es-MX").format(cantidad ?? 0);
}
