import type { NotaVenta, DetalleVenta } from "../types/models";
import { daysAgoIso, todayIso } from "./format";

export type VentaConComprador = NotaVenta & { comprador: string };

export function sumaEnRango(notas: VentaConComprador[], desde: string, hasta: string): number {
  return notas
    .filter((n) => n.fecha >= desde && n.fecha <= hasta)
    .reduce((acc, n) => acc + n.total_venta, 0);
}

export function sumaDelMesActual(notas: VentaConComprador[]): number {
  const mesActual = todayIso().slice(0, 7);
  return notas
    .filter((n) => n.fecha.slice(0, 7) === mesActual)
    .reduce((acc, n) => acc + n.total_venta, 0);
}

export interface PuntoVentaDiaria {
  fecha: string;
  total: number;
}

export function ventasPorDia(notas: VentaConComprador[], dias: number): PuntoVentaDiaria[] {
  const inicio = daysAgoIso(dias - 1);
  const totalesPorFecha = new Map<string, number>();

  for (const nota of notas) {
    if (nota.fecha < inicio) continue;
    totalesPorFecha.set(nota.fecha, (totalesPorFecha.get(nota.fecha) ?? 0) + nota.total_venta);
  }

  const puntos: PuntoVentaDiaria[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const fecha = daysAgoIso(i);
    puntos.push({ fecha, total: totalesPorFecha.get(fecha) ?? 0 });
  }
  return puntos;
}

export interface PuntoVentaColor {
  color: string;
  total: number;
  pinas: number;
}

export function ventasPorColor(detalles: DetalleVenta[]): PuntoVentaColor[] {
  const porColor = new Map<string, { total: number; pinas: number }>();
  for (const d of detalles) {
    const clave = d.color_pina.trim() || "Sin especificar";
    const actual = porColor.get(clave) ?? { total: 0, pinas: 0 };
    actual.total += d.subtotal;
    actual.pinas += d.cantidad_pinas;
    porColor.set(clave, actual);
  }
  return Array.from(porColor.entries())
    .map(([color, v]) => ({ color, total: v.total, pinas: v.pinas }))
    .sort((a, b) => b.total - a.total);
}

// ============================================
// PIÑAS VENDIDAS (volumen, no dinero)
// ============================================

// Las líneas de detalle no guardan fecha propia: la heredan de su nota.
export type DetalleConFecha = DetalleVenta & { fecha: string };

export function pinasEnRango(
  detalles: DetalleConFecha[],
  desde: string,
  hasta: string
): number {
  return detalles
    .filter((d) => d.fecha >= desde && d.fecha <= hasta)
    .reduce((acc, d) => acc + d.cantidad_pinas, 0);
}

export interface Comparativo {
  actual: number;
  anterior: number;
  /** null cuando no hay con qué comparar (el periodo anterior fue cero). */
  cambioPct: number | null;
}

export function comparar(actual: number, anterior: number): Comparativo {
  return {
    actual,
    anterior,
    cambioPct: anterior === 0 ? null : ((actual - anterior) / anterior) * 100,
  };
}

export interface PuntoPinasMes {
  mes: string; // "YYYY-MM"
  pinas: number;
  total: number;
}

export function pinasPorMes(
  detalles: DetalleConFecha[],
  meses: string[]
): PuntoPinasMes[] {
  const porMes = new Map<string, { pinas: number; total: number }>();
  for (const d of detalles) {
    const mes = d.fecha.slice(0, 7);
    const actual = porMes.get(mes) ?? { pinas: 0, total: 0 };
    actual.pinas += d.cantidad_pinas;
    actual.total += d.subtotal;
    porMes.set(mes, actual);
  }
  // Se recorre la lista de meses pedida para que los meses sin ventas
  // aparezcan en cero en vez de desaparecer de la gráfica.
  return meses.map((mes) => ({
    mes,
    pinas: porMes.get(mes)?.pinas ?? 0,
    total: porMes.get(mes)?.total ?? 0,
  }));
}

export interface ResumenPago {
  pagado: { count: number; total: number };
  pendiente: { count: number; total: number };
}

export function resumenPago(notas: VentaConComprador[]): ResumenPago {
  const resumen: ResumenPago = {
    pagado: { count: 0, total: 0 },
    pendiente: { count: 0, total: 0 },
  };
  for (const nota of notas) {
    const bucket = nota.pagado ? resumen.pagado : resumen.pendiente;
    bucket.count += 1;
    bucket.total += nota.total_venta;
  }
  return resumen;
}
