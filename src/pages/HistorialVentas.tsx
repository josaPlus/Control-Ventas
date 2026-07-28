import { useEffect, useMemo, useState } from "react";
import type { NotaVentaCompleta } from "../types/models";
import type { VentaConComprador } from "../lib/dashboardStats";
import { listarNotasVenta, obtenerNotaCompleta, actualizarEstadoPago, eliminarNotaVenta } from "../db/database";
import { formatMoney, formatDateLong } from "../lib/format";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import NotaVentaForm from "../components/NotaVentaForm";
import { useConfiguracion } from "../context/ConfiguracionContext";
import { IconPencil, IconTrash } from "../components/Icons";
import styles from "./HistorialVentas.module.css";

type FiltroEstado = "todos" | "pagado" | "pendiente";

export default function HistorialVentas() {
  const { manejaTipos } = useConfiguracion();
  const [notas, setNotas] = useState<VentaConComprador[]>([]);
  const [cargando, setCargando] = useState(true);

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [estado, setEstado] = useState<FiltroEstado>("todos");
  const [texto, setTexto] = useState("");

  const [notaAbierta, setNotaAbierta] = useState<NotaVentaCompleta | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [editando, setEditando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

  useEffect(() => {
    cargarNotas();
  }, []);

  async function cargarNotas() {
    setCargando(true);
    try {
      const datos = await listarNotasVenta();
      setNotas(datos);
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }

  // La columna aparece si el negocio maneja tipos, pero TAMBIÉN si esta nota en
  // concreto ya trae alguno. Así, si alguien apaga el ajuste, las ventas que
  // sí llevaban tipo siguen mostrando lo que se vendió en vez de esconderlo.
  const mostrarTipo =
    manejaTipos || (notaAbierta?.detalles.some((d) => d.tipo_hilo?.trim()) ?? false);

  const notasFiltradas = useMemo(() => {
    return notas.filter((n) => {
      if (desde && n.fecha < desde) return false;
      if (hasta && n.fecha > hasta) return false;
      if (estado === "pagado" && !n.pagado) return false;
      if (estado === "pendiente" && n.pagado) return false;
      if (texto.trim() && !n.comprador.toLowerCase().includes(texto.trim().toLowerCase())) return false;
      return true;
    });
  }, [notas, desde, hasta, estado, texto]);

  function limpiarFiltros() {
    setDesde("");
    setHasta("");
    setEstado("todos");
    setTexto("");
  }

  async function abrirDetalle(id: number) {
    setCargandoDetalle(true);
    setNotaAbierta(null);
    setEditando(false);
    try {
      const completa = await obtenerNotaCompleta(id);
      setNotaAbierta(completa);
    } catch (err) {
      console.error(err);
    } finally {
      setCargandoDetalle(false);
    }
  }

  // Atajos desde la fila: cargan la nota completa y abren directamente el
  // formulario o la confirmación, sin pasar por la vista de detalle.
  async function editarDesdeFila(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await abrirDetalle(id);
    setEditando(true);
  }

  async function eliminarDesdeFila(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await abrirDetalle(id);
    setConfirmandoBorrado(true);
  }

  function cerrarDetalle() {
    setNotaAbierta(null);
    setEditando(false);
    setConfirmandoBorrado(false);
  }

  // Tras editar, se recarga el detalle para que la vista refleje lo guardado.
  async function alGuardarEdicion() {
    const id = notaAbierta!.id!;
    setEditando(false);
    await cargarNotas();
    await abrirDetalle(id);
  }

  // El error se propaga a propósito: lo muestra el propio diálogo.
  async function borrarNota() {
    await eliminarNotaVenta(notaAbierta!.id!);
    setConfirmandoBorrado(false);
    cerrarDetalle();
    await cargarNotas();
  }

  async function togglePagado(id: number, pagadoActual: boolean, e?: React.MouseEvent) {
    e?.stopPropagation();
    const nuevoEstado = !pagadoActual;
    setNotas((prev) => prev.map((n) => (n.id === id ? { ...n, pagado: nuevoEstado } : n)));
    if (notaAbierta?.id === id) {
      setNotaAbierta({ ...notaAbierta, pagado: nuevoEstado });
    }
    try {
      await actualizarEstadoPago(id, nuevoEstado);
    } catch (err) {
      console.error(err);
      setNotas((prev) => prev.map((n) => (n.id === id ? { ...n, pagado: pagadoActual } : n)));
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Historial de ventas</h1>
      <p className={styles.pageSubtitle}>Consulta, filtra y da seguimiento a tus notas de venta.</p>

      <div className={`card ${styles.filters}`}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="desde">Desde</label>
          <input id="desde" type="date" className={`input ${styles.filterInput}`} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="hasta">Hasta</label>
          <input id="hasta" type="date" className={`input ${styles.filterInput}`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="estado">Estado</label>
          <select id="estado" className={`select ${styles.filterInput}`} value={estado} onChange={(e) => setEstado(e.target.value as FiltroEstado)}>
            <option value="todos">Todos</option>
            <option value="pagado">Pagado</option>
            <option value="pendiente">Pendiente</option>
          </select>
        </div>
        <div className={`${styles.filterField} ${styles.searchField}`}>
          <label className={styles.filterLabel} htmlFor="buscar-comprador">Comprador</label>
          <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            id="buscar-comprador"
            className={`input ${styles.searchInput}`}
            placeholder="Buscar por nombre..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <button type="button" className={`btn btn-secondary ${styles.clearBtn}`} onClick={limpiarFiltros}>
          Limpiar filtros
        </button>
      </div>

      {cargando && <div className={styles.emptyState}>Cargando notas de venta...</div>}

      {!cargando && notasFiltradas.length === 0 && (
        <div className={`card ${styles.emptyState}`}>No se encontraron notas de venta con estos filtros.</div>
      )}

      {!cargando && notasFiltradas.length > 0 && (
        <div className={`card ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th># Nota</th>
                <th>Fecha</th>
                <th>Comprador</th>
                <th>Tipo de depósito</th>
                <th>Total</th>
                <th>Estado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {notasFiltradas.map((n) => (
                <tr key={n.id} className={styles.tableRow} onClick={() => abrirDetalle(n.id!)}>
                  <td className={styles.numeroCell}>#{n.numero_nota}</td>
                  <td>{formatDateLong(n.fecha)}</td>
                  <td>{n.comprador}</td>
                  <td>{n.tipo_deposito === "efectivo" ? "Efectivo" : "Depósito"}</td>
                  <td className={styles.totalCell}>{formatMoney(n.total_venta)}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.toggle}
                      onClick={(e) => togglePagado(n.id!, n.pagado, e)}
                      title={n.pagado ? "Marcar como pendiente" : "Marcar como pagado"}
                    >
                      <span className={`${styles.switch} ${n.pagado ? styles.switchOn : ""}`}>
                        <span className={styles.switchKnob} />
                      </span>
                      <span className={`badge ${n.pagado ? "badge-good" : "badge-warning"}`}>
                        {n.pagado ? "Pagado" : "Pendiente"}
                      </span>
                    </button>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={(e) => editarDesdeFila(n.id!, e)}
                        title="Editar nota"
                        aria-label={`Editar la nota #${n.numero_nota}`}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={(e) => eliminarDesdeFila(n.id!, e)}
                        title="Eliminar nota"
                        aria-label={`Eliminar la nota #${n.numero_nota}`}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(cargandoDetalle || notaAbierta) && (
        <Modal
          title={
            !notaAbierta
              ? "Cargando..."
              : editando
                ? `Editar nota #${notaAbierta.numero_nota}`
                : `Nota #${notaAbierta.numero_nota}`
          }
          ancho={editando}
          onClose={cerrarDetalle}
        >
          {cargandoDetalle && <div className={styles.detailLoading}>Cargando detalle...</div>}

          {!cargandoDetalle && notaAbierta && editando && (
            <NotaVentaForm
              notaExistente={notaAbierta}
              onGuardado={alGuardarEdicion}
              onCancelar={() => setEditando(false)}
            />
          )}

          {!cargandoDetalle && notaAbierta && !editando && (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <div className={styles.detailClienteName}>{notaAbierta.cliente.comprador}</div>
                  <div className={styles.detailMeta}>{notaAbierta.cliente.domicilio}</div>
                  <div className={styles.detailMeta}>Tel. {notaAbierta.cliente.telefono}</div>
                </div>
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={(e) => togglePagado(notaAbierta.id!, notaAbierta.pagado, e)}
                >
                  <span className={`${styles.switch} ${notaAbierta.pagado ? styles.switchOn : ""}`}>
                    <span className={styles.switchKnob} />
                  </span>
                  <span className={`badge ${notaAbierta.pagado ? "badge-good" : "badge-warning"}`}>
                    {notaAbierta.pagado ? "Pagado" : "Pendiente"}
                  </span>
                </button>
              </div>

              <div className={styles.detailMeta}>
                {formatDateLong(notaAbierta.fecha)} · {notaAbierta.tipo_deposito === "efectivo" ? "Efectivo" : "Depósito"}
              </div>

              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    {mostrarTipo && <th>Tipo de hilo</th>}
                    <th>Color del hilo</th>
                    <th>Piñas</th>
                    <th>Precio x piña</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {notaAbierta.detalles.map((d) => (
                    <tr key={d.id}>
                      {mostrarTipo && <td>{d.tipo_hilo || "—"}</td>}
                      <td>{d.color_pina}</td>
                      <td>{d.cantidad_pinas}</td>
                      <td>{formatMoney(d.precio_pina)}</td>
                      <td>{formatMoney(d.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className={styles.detailTotalRow}>
                <span>Total: {formatMoney(notaAbierta.total_venta)}</span>
              </div>

              {notaAbierta.comentario && (
                <div className={styles.detailComentario}>{notaAbierta.comentario}</div>
              )}

              <div className={styles.detailActions}>
                <button
                  type="button"
                  className={`btn btn-secondary btn-sm ${styles.actionBtn}`}
                  onClick={() => setEditando(true)}
                >
                  <IconPencil />
                  Editar
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary btn-sm ${styles.actionBtn} ${styles.actionBtnDanger}`}
                  onClick={() => setConfirmandoBorrado(true)}
                >
                  <IconTrash />
                  Eliminar
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {confirmandoBorrado && notaAbierta && (
        <ConfirmDialog
          title={`¿Eliminar la nota #${notaAbierta.numero_nota}?`}
          message={
            <>
              Se borrará la venta de <strong>{notaAbierta.cliente.comprador}</strong> por{" "}
              <strong>{formatMoney(notaAbierta.total_venta)}</strong> y sus{" "}
              {notaAbierta.detalles.length}{" "}
              {notaAbierta.detalles.length === 1 ? "línea" : "líneas"} de detalle. Esta
              acción no se puede deshacer.
            </>
          }
          confirmLabel="Eliminar nota"
          tono="peligro"
          onConfirm={borrarNota}
          onCancel={() => setConfirmandoBorrado(false)}
        />
      )}
    </div>
  );
}
