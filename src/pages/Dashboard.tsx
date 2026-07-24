import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { listarNotasVenta, obtenerNotaCompleta } from "../db/database";
import type { DetalleVenta } from "../types/models";
import { formatMoney, formatDateLong, todayIso, daysAgoIso } from "../lib/format";
import {
  type VentaConComprador,
  sumaEnRango,
  sumaDelMesActual,
  ventasPorDia,
  ventasPorColor,
  resumenPago,
} from "../lib/dashboardStats";
import ChartTooltip from "../components/ChartTooltip";
import styles from "./Dashboard.module.css";

export default function Dashboard() {
  const [notas, setNotas] = useState<VentaConComprador[]>([]);
  const [detalles, setDetalles] = useState<DetalleVenta[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setCargando(true);
    try {
      const listaNotas = await listarNotasVenta();
      setNotas(listaNotas);

      // NOTA: listarNotasVenta() no incluye las líneas de detalle (colores de hilo).
      // Se traen aquí una por una con obtenerNotaCompleta(). Para un negocio con
      // volúmenes grandes de notas convendría una función de agregación en el
      // backend (p. ej. ventasPorColorPina()); con el volumen típico de este
      // negocio esto es suficiente.
      const completas = await Promise.all(
        listaNotas.map((n) => obtenerNotaCompleta(n.id!))
      );
      const todosLosDetalles = completas.flatMap((c) => c?.detalles ?? []);
      setDetalles(todosLosDetalles);
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }

  const totalHoy = useMemo(() => sumaEnRango(notas, todayIso(), todayIso()), [notas]);
  const totalSemana = useMemo(() => sumaEnRango(notas, daysAgoIso(6), todayIso()), [notas]);
  const totalMes = useMemo(() => sumaDelMesActual(notas), [notas]);

  const serieDiaria = useMemo(() => ventasPorDia(notas, 14), [notas]);
  const serieColor = useMemo(() => ventasPorColor(detalles), [detalles]);
  const pago = useMemo(() => resumenPago(notas), [notas]);

  const datosPago = [
    { name: "Pagado", value: pago.pagado.total, count: pago.pagado.count, color: "var(--status-good)" },
    { name: "Pendiente", value: pago.pendiente.total, count: pago.pendiente.count, color: "var(--status-warning)" },
  ].filter((d) => d.count > 0);

  if (cargando) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Cargando información del panel...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Panel de ventas</h1>
      <p className={styles.pageSubtitle}>Resumen del rendimiento de tu negocio.</p>

      <div className={styles.statsRow}>
        <StatCard label="Vendido hoy" value={formatMoney(totalHoy)} />
        <StatCard label="Vendido esta semana" value={formatMoney(totalSemana)} />
        <StatCard label="Vendido este mes" value={formatMoney(totalMes)} />
      </div>

      <div className={styles.chartsGrid}>
        <div className={`card ${styles.chartCard}`}>
          <h3 className={styles.chartTitle}>Ventas de los últimos 14 días</h3>
          <p className={styles.chartSubtitle}>Total vendido por día.</p>
          {serieDiaria.every((p) => p.total === 0) ? (
            <div className={styles.emptyChart}>Aún no hay ventas registradas en este periodo.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={serieDiaria} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="fecha"
                  tickFormatter={(f) => formatDateLong(f)}
                  tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatMoney(v)}
                  tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-hover)" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    return (
                      <ChartTooltip
                        title={formatDateLong(label as string)}
                        rows={[{ label: "Total", value: formatMoney(payload[0].value as number), color: "var(--series-1)" }]}
                      />
                    );
                  }}
                />
                <Bar dataKey="total" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className={styles.chartsRow}>
        <div className={`card ${styles.chartCard}`}>
          <h3 className={styles.chartTitle}>Ventas por color de hilo</h3>
          <p className={styles.chartSubtitle}>Qué variedades se venden más.</p>
          {serieColor.length === 0 ? (
            <div className={styles.emptyChart}>Aún no hay líneas de venta registradas.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, serieColor.length * 44)}>
              <BarChart
                data={serieColor}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v) => formatMoney(v)}
                  tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="color"
                  tick={{ fill: "var(--ink-primary)", fontSize: 12, fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-hover)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const item = payload[0].payload as { color: string; total: number };
                    return (
                      <ChartTooltip
                        title={item.color}
                        rows={[{ label: "Vendido", value: formatMoney(item.total), color: "var(--series-1)" }]}
                      />
                    );
                  }}
                />
                <Bar dataKey="total" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className={`card ${styles.chartCard}`}>
          <h3 className={styles.chartTitle}>Pagado vs. pendiente</h3>
          <p className={styles.chartSubtitle}>Estado de cobro de las notas de venta.</p>
          {datosPago.length === 0 ? (
            <div className={styles.emptyChart}>Aún no hay notas de venta registradas.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={datosPago}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    strokeWidth={2}
                    stroke="var(--surface-card)"
                  >
                    {datosPago.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const item = payload[0].payload as { name: string; value: number; count: number; color: string };
                      return (
                        <ChartTooltip
                          title={item.name}
                          rows={[
                            { label: "Total", value: formatMoney(item.value), color: item.color },
                            { label: "Notas", value: String(item.count) },
                          ]}
                        />
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className={styles.legendRow}>
                {datosPago.map((d) => (
                  <div key={d.name} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ backgroundColor: d.color }} />
                    {d.name} · {d.count} {d.count === 1 ? "nota" : "notas"} · {formatMoney(d.value)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`card ${styles.statCard}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
