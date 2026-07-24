import { useEffect, useState } from "react";
import type { Cliente, DetalleVenta } from "../types/models";
import { crearNotaVenta, obtenerSiguienteNumeroNota } from "../db/database";
import { formatMoney, todayIso } from "../lib/format";
import ClienteAutocomplete from "./ClienteAutocomplete";
import DetalleVentaRow, { COLORES_PINA_SUGERIDOS } from "./DetalleVentaRow";
import styles from "./NotaVentaForm.module.css";

function detalleVacio(): DetalleVenta {
  return { color_pina: "", cantidad_pinas: 0, precio_pina: 0, subtotal: 0 };
}

interface FormErrors {
  cliente?: string;
  fecha?: string;
  tipo_deposito?: string;
  detalles?: Record<number, { color_pina?: string; cantidad_pinas?: string; precio_pina?: string }>;
}

export default function NotaVentaForm() {
  const [numeroNota, setNumeroNota] = useState<number | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [fecha, setFecha] = useState(todayIso());
  const [tipoDeposito, setTipoDeposito] = useState<"efectivo" | "deposito">("efectivo");
  const [pagado, setPagado] = useState(false);
  const [comentario, setComentario] = useState("");
  const [detalles, setDetalles] = useState<DetalleVenta[]>([detalleVacio()]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    cargarSiguienteNumero();
  }, []);

  async function cargarSiguienteNumero() {
    try {
      const siguiente = await obtenerSiguienteNumeroNota();
      setNumeroNota(siguiente);
    } catch (err) {
      console.error(err);
    }
  }

  const total = detalles.reduce((acc, d) => acc + (d.subtotal || 0), 0);

  function actualizarDetalle(index: number, detalle: DetalleVenta) {
    setDetalles((prev) => prev.map((d, i) => (i === index ? detalle : d)));
  }

  function agregarDetalle() {
    setDetalles((prev) => [...prev, detalleVacio()]);
  }

  function quitarDetalle(index: number) {
    setDetalles((prev) => prev.filter((_, i) => i !== index));
  }

  function validar(): boolean {
    const nuevo: FormErrors = {};

    if (!cliente) nuevo.cliente = "Selecciona o registra un cliente";
    if (!fecha) nuevo.fecha = "La fecha es obligatoria";
    if (!tipoDeposito) nuevo.tipo_deposito = "Selecciona el tipo de depósito";

    const detalleErrors: FormErrors["detalles"] = {};
    detalles.forEach((d, i) => {
      const rowErr: { color_pina?: string; cantidad_pinas?: string; precio_pina?: string } = {};
      if (!d.color_pina.trim()) rowErr.color_pina = "Requerido";
      if (!d.cantidad_pinas || d.cantidad_pinas < 1) rowErr.cantidad_pinas = "Requerido";
      if (!d.precio_pina || d.precio_pina <= 0) rowErr.precio_pina = "Requerido";
      if (Object.keys(rowErr).length > 0) detalleErrors[i] = rowErr;
    });
    if (Object.keys(detalleErrors).length > 0) nuevo.detalles = detalleErrors;

    setErrors(nuevo);
    return Object.keys(nuevo).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("idle");
    if (!validar()) return;

    setStatus("submitting");
    try {
      const guardada = await crearNotaVenta(
        {
          cliente_id: cliente!.id!,
          fecha,
          tipo_deposito: tipoDeposito,
          pagado,
          comentario: comentario.trim() || undefined,
          total_venta: total,
        },
        detalles.map(({ color_pina, cantidad_pinas, precio_pina, subtotal }) => ({
          color_pina,
          cantidad_pinas,
          precio_pina,
          subtotal,
        }))
      );

      // El número definitivo lo asigna el backend dentro de la transacción;
      // el que se muestra en pantalla antes de guardar es solo una previsualización.
      setStatusMsg(`Nota #${guardada.numero_nota} guardada correctamente.`);
      setStatus("success");

      setCliente(null);
      setFecha(todayIso());
      setTipoDeposito("efectivo");
      setPagado(false);
      setComentario("");
      setDetalles([detalleVacio()]);
      setErrors({});
      cargarSiguienteNumero();
    } catch (err) {
      console.error(err);
      const detalle = err instanceof Error ? err.message : String(err);
      setStatusMsg(`Ocurrió un error al guardar la venta: ${detalle}`);
      setStatus("error");
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <datalist id="colores-pina">
        {COLORES_PINA_SUGERIDOS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className={`card ${styles.headerCard}`}>
        <div className={styles.numeroNota}>
          <span className={styles.numeroNotaLabel}>Nota de venta</span>
          <span className={styles.numeroNotaValue}>
            {numeroNota !== null ? `#${numeroNota}` : "..."}
          </span>
        </div>
      </div>

      <div className={`card ${styles.section}`}>
        <h3 className={styles.sectionTitle}>Cliente</h3>
        <ClienteAutocomplete
          selectedCliente={cliente}
          onSelectCliente={setCliente}
          onClearSelection={() => setCliente(null)}
        />
        {errors.cliente && <span className="field-error">{errors.cliente}</span>}
      </div>

      <div className={`card ${styles.section}`}>
        <h3 className={styles.sectionTitle}>Detalles de la venta</h3>

        <div className={styles.grid2}>
          <div className="field">
            <label className="field-label field-required" htmlFor="fecha">
              Fecha
            </label>
            <input
              id="fecha"
              type="date"
              className={`input ${errors.fecha ? "input-error" : ""}`}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
            {errors.fecha && <span className="field-error">{errors.fecha}</span>}
          </div>

          <div className="field">
            <span className="field-label field-required">Tipo de depósito</span>
            <div className={styles.radioGroup}>
              {(["efectivo", "deposito"] as const).map((opcion) => (
                <label
                  key={opcion}
                  className={`${styles.radioOption} ${tipoDeposito === opcion ? styles.radioOptionChecked : ""}`}
                >
                  <input
                    type="radio"
                    name="tipo_deposito"
                    value={opcion}
                    checked={tipoDeposito === opcion}
                    onChange={() => setTipoDeposito(opcion)}
                    className="visually-hidden"
                  />
                  {opcion === "efectivo" ? "Efectivo" : "Depósito"}
                </label>
              ))}
            </div>
            {errors.tipo_deposito && <span className="field-error">{errors.tipo_deposito}</span>}
          </div>
        </div>

        <label className={styles.checkboxOption}>
          <input type="checkbox" checked={pagado} onChange={(e) => setPagado(e.target.checked)} />
          Marcar como pagado
        </label>

        <div className="field">
          <label className="field-label" htmlFor="comentario">
            Comentario (opcional)
          </label>
          <textarea
            id="comentario"
            className="textarea"
            placeholder="Notas adicionales sobre esta venta..."
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </div>
      </div>

      <div className={`card ${styles.section}`}>
        <div className={styles.detallesHeader}>
          <h3 className={styles.sectionTitle}>Piñas de hilo vendidas</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={agregarDetalle}>
            + Agregar línea
          </button>
        </div>

        <div className={styles.detallesList}>
          {detalles.map((detalle, index) => (
            <DetalleVentaRow
              key={index}
              detalle={detalle}
              onChange={(d) => actualizarDetalle(index, d)}
              onRemove={() => quitarDetalle(index)}
              canRemove={detalles.length > 1}
              errors={errors.detalles?.[index]}
            />
          ))}
        </div>

        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>Total de la venta</span>
          <span className={styles.totalValue}>{formatMoney(total)}</span>
        </div>
      </div>

      {status === "success" && <div className={`${styles.feedback} ${styles.feedbackSuccess}`}>{statusMsg}</div>}
      {status === "error" && <div className={`${styles.feedback} ${styles.feedbackError}`}>{statusMsg}</div>}

      <div className={styles.formFooter}>
        <button type="submit" className={`btn btn-primary ${styles.submitBtn}`} disabled={status === "submitting"}>
          {status === "submitting" ? "Guardando..." : "Guardar venta"}
        </button>
      </div>
    </form>
  );
}
