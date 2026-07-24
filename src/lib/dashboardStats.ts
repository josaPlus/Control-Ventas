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
}

export function ventasPorColor(detalles: DetalleVenta[]): PuntoVentaColor[] {
  const totalesPorColor = new Map<string, number>();
  for (const d of detalles) {
    const clave = d.color_pina.trim() || "Sin especificar";
    totalesPorColor.set(clave, (totalesPorColor.get(clave) ?? 0) + d.subtotal);
  }
  return Array.from(totalesPorColor.entries())
    .map(([color, total]) => ({ color, total }))
    .sort((a, b) => b.total - a.total);
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
