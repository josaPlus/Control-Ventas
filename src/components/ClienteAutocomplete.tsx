import { useEffect, useRef, useState } from "react";
import type { Cliente } from "../types/models";
import { buscarClientes } from "../db/database";
import ClienteForm from "./ClienteForm";
import styles from "./ClienteAutocomplete.module.css";

interface ClienteAutocompleteProps {
  selectedCliente: Cliente | null;
  onSelectCliente: (cliente: Cliente) => void;
  onClearSelection: () => void;
}

export default function ClienteAutocomplete({
  selectedCliente,
  onSelectCliente,
  onClearSelection,
}: ClienteAutocompleteProps) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (texto.trim().length === 0) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        const clientes = await buscarClientes(texto.trim());
        setResultados(clientes);
      } catch (err) {
        console.error(err);
      } finally {
        setBuscando(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [texto]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (selectedCliente) {
    return (
      <div className={styles.selectedCard}>
        <div className={styles.selectedInfo}>
          <span className={styles.selectedName}>{selectedCliente.comprador}</span>
          <span className={styles.selectedMeta}>{selectedCliente.domicilio}</span>
          <span className={styles.selectedMeta}>Tel. {selectedCliente.telefono}</span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            onClearSelection();
            setTexto("");
            setMostrarNuevo(false);
          }}
        >
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <div className={styles.searchBox}>
        <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className={`input ${styles.searchInput}`}
          placeholder="Buscar cliente por nombre o teléfono..."
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
            setMostrarNuevo(false);
          }}
          onFocus={() => setAbierto(true)}
        />
      </div>

      {abierto && texto.trim().length > 0 && !mostrarNuevo && (
        <div className={styles.dropdown}>
          {buscando && <div className={styles.emptyText}>Buscando...</div>}
          {!buscando && resultados.length > 0 &&
            resultados.map((cliente) => (
              <button
                key={cliente.id}
                type="button"
                className={styles.option}
                onClick={() => {
                  onSelectCliente(cliente);
                  setAbierto(false);
                }}
              >
                <span className={styles.optionName}>{cliente.comprador}</span>
                <span className={styles.optionMeta}>
                  {cliente.domicilio} · Tel. {cliente.telefono}
                </span>
              </button>
            ))}
          {!buscando && resultados.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyText}>No se encontró ningún cliente con "{texto}".</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setMostrarNuevo(true)}
              >
                + Registrar nuevo cliente
              </button>
            </div>
          )}
        </div>
      )}

      {mostrarNuevo && (
        <div className={styles.newClienteBox}>
          <div className={styles.newClienteTitle}>Registrar nuevo cliente</div>
          <ClienteForm
            initialComprador={texto}
            submitLabel="Guardar y seleccionar"
            onSaved={(cliente) => {
              onSelectCliente(cliente);
              setMostrarNuevo(false);
              setAbierto(false);
              // Los resultados de la búsqueda anterior son de antes de crear
              // este cliente; si no se limpian, al volver a "Cambiar" se
              // mostraría "no se encontró" sobre datos viejos.
              setTexto("");
              setResultados([]);
            }}
            onCancel={() => setMostrarNuevo(false)}
          />
        </div>
      )}
    </div>
  );
}
