import type { DetalleVenta } from "../types/models";
import { formatMoney } from "../lib/format";
import SelectorCatalogo from "./SelectorCatalogo";
import styles from "./DetalleVentaRow.module.css";

interface DetalleVentaRowErrors {
  color_pina?: string;
  cantidad_pinas?: string;
  precio_pina?: string;
  tipo_hilo?: string;
}

interface DetalleVentaRowProps {
  detalle: DetalleVenta;
  onChange: (detalle: DetalleVenta) => void;
  onRemove: () => void;
  canRemove: boolean;
  errors?: DetalleVentaRowErrors;
  /**
   * Depende del ajuste del negocio, no de si el catálogo tiene registros: si
   * dependiera del catálogo, el primer tipo nunca se podría dar de alta.
   */
  manejaTipos: boolean;
  colores: string[];
  tipos: string[];
  /** Para que el formulario relea los catálogos tras un alta desde la fila. */
  onCatalogoActualizado: () => void | Promise<void>;
}

export default function DetalleVentaRow({
  detalle,
  onChange,
  onRemove,
  canRemove,
  errors,
  manejaTipos,
  colores,
  tipos,
  onCatalogoActualizado,
}: DetalleVentaRowProps) {
  function actualizar(campo: keyof DetalleVenta, valor: string | number) {
    const siguiente: DetalleVenta = { ...detalle, [campo]: valor };
    siguiente.subtotal = round2(
      Number(siguiente.cantidad_pinas || 0) * Number(siguiente.precio_pina || 0)
    );
    onChange(siguiente);
  }

  return (
    <div className={`${styles.row} ${manejaTipos ? styles.rowConTipo : ""}`}>
      {manejaTipos && (
        <SelectorCatalogo
          catalogo="tipos_hilo"
          valor={detalle.tipo_hilo ?? ""}
          opciones={tipos}
          onChange={(v) => actualizar("tipo_hilo", v)}
          onAgregado={onCatalogoActualizado}
          placeholder="Tipo de hilo"
          error={errors?.tipo_hilo}
        />
      )}

      <SelectorCatalogo
        catalogo="colores_hilo"
        valor={detalle.color_pina}
        opciones={colores}
        onChange={(v) => actualizar("color_pina", v)}
        onAgregado={onCatalogoActualizado}
        placeholder="Color del hilo"
        error={errors?.color_pina}
      />

      <div className="field">
        <input
          type="number"
          min={1}
          step={1}
          className={`input ${errors?.cantidad_pinas ? "input-error" : ""}`}
          placeholder="Piñas"
          value={detalle.cantidad_pinas === 0 ? "" : detalle.cantidad_pinas}
          onChange={(e) => actualizar("cantidad_pinas", Number(e.target.value))}
          aria-label="Cantidad de piñas de hilo"
        />
        {errors?.cantidad_pinas && <span className={styles.errorText}>{errors.cantidad_pinas}</span>}
      </div>

      <div className="field">
        <input
          type="number"
          min={0}
          step={0.5}
          className={`input ${errors?.precio_pina ? "input-error" : ""}`}
          placeholder="Precio por piña"
          value={detalle.precio_pina === 0 ? "" : detalle.precio_pina}
          onChange={(e) => actualizar("precio_pina", Number(e.target.value))}
          aria-label="Precio por piña de hilo"
        />
        {errors?.precio_pina && <span className={styles.errorText}>{errors.precio_pina}</span>}
      </div>

      <div className={styles.subtotalBox}>{formatMoney(detalle.subtotal)}</div>

      <button
        type="button"
        className={styles.removeBtn}
        onClick={onRemove}
        disabled={!canRemove}
        title="Quitar línea"
        aria-label="Quitar línea"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
