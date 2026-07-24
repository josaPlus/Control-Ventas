import styles from "./ChartTooltip.module.css";

interface ChartTooltipRow {
  label: string;
  value: string;
  color?: string;
}

interface ChartTooltipProps {
  title: string;
  rows: ChartTooltipRow[];
}

export default function ChartTooltip({ title, rows }: ChartTooltipProps) {
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{title}</div>
      {rows.map((row) => (
        <div key={row.label} className={styles.tooltipRow}>
          {row.color && <span className={styles.tooltipDot} style={{ backgroundColor: row.color }} />}
          <span>{row.label}:</span>
          <span className={styles.tooltipValue}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
