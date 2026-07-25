import { useEffect, useState } from "react";
import type { Cliente } from "../types/models";
import { listarClientes, buscarClientes, eliminarCliente } from "../db/database";
import Modal from "../components/Modal";
import ClienteForm from "../components/ClienteForm";
import ConfirmDialog from "../components/ConfirmDialog";
import { IconPencil, IconTrash } from "../components/Icons";
import styles from "./Clientes.module.css";

export default function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState("");
  const [modal, setModal] = useState<null | { modo: "crear" } | { modo: "editar"; cliente: Cliente }>(null);
  const [porEliminar, setPorEliminar] = useState<Cliente | null>(null);

  useEffect(() => {
    cargarClientes();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      cargarClientes(texto);
    }, 250);
    return () => clearTimeout(timer);
  }, [texto]);

  async function cargarClientes(filtro?: string) {
    setCargando(true);
    try {
      const datos = filtro && filtro.trim().length > 0 ? await buscarClientes(filtro.trim()) : await listarClientes();
      setClientes(datos);
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }

  function onSaved() {
    setModal(null);
    cargarClientes(texto);
  }

  // El error se propaga a propósito para que el diálogo lo muestre: el backend
  // rechaza el borrado si el cliente ya tiene ventas y explica cuántas son.
  async function borrarCliente() {
    await eliminarCliente(porEliminar!.id!);
    setPorEliminar(null);
    await cargarClientes(texto);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>Clientes</h1>
          <p className={styles.pageSubtitle}>Consulta y administra los datos de tus compradores.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ modo: "crear" })}>
          + Agregar cliente
        </button>
      </div>

      <div className={styles.toolbar}>
        <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className={`input ${styles.searchInput}`}
          placeholder="Buscar por nombre o teléfono..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      {!cargando && clientes.length === 0 && (
        <div className={`card ${styles.emptyState}`}>
          {texto ? "No se encontraron clientes con ese criterio." : "Aún no hay clientes registrados."}
        </div>
      )}

      <div className={styles.list}>
        {clientes.map((cliente) => (
          <div key={cliente.id} className={`card ${styles.row}`}>
            <div className={styles.info}>
              <span className={styles.name}>{cliente.comprador}</span>
              <span className={styles.meta}>{cliente.domicilio}</span>
              <span className={styles.meta}>Tel. {cliente.telefono}</span>
            </div>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setModal({ modo: "editar", cliente })}
                title="Editar cliente"
                aria-label={`Editar a ${cliente.comprador}`}
              >
                <IconPencil />
              </button>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                onClick={() => setPorEliminar(cliente)}
                title="Eliminar cliente"
                aria-label={`Eliminar a ${cliente.comprador}`}
              >
                <IconTrash />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <Modal title={modal.modo === "crear" ? "Agregar cliente" : "Editar cliente"} onClose={() => setModal(null)}>
          <ClienteForm
            initialValue={modal.modo === "editar" ? modal.cliente : undefined}
            submitLabel={modal.modo === "crear" ? "Agregar cliente" : "Guardar cambios"}
            onSaved={onSaved}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {porEliminar && (
        <ConfirmDialog
          title={`¿Eliminar a ${porEliminar.comprador}?`}
          message={
            <>
              Se borrarán sus datos de contacto ({porEliminar.domicilio}, tel.{" "}
              {porEliminar.telefono}). Esta acción no se puede deshacer.
            </>
          }
          confirmLabel="Eliminar cliente"
          tono="peligro"
          onConfirm={borrarCliente}
          onCancel={() => setPorEliminar(null)}
        />
      )}
    </div>
  );
}
