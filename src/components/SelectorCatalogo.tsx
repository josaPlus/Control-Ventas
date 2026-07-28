import { useRef, useState } from "react";
import { type Catalogo, agregarEntradaCatalogo } from "../db/database";
import styles from "./SelectorCatalogo.module.css";

// Valor centinela de la opción "agregar nuevo". Lleva caracteres que no pueden
// aparecer en un nombre normalizado, para que nunca choque con uno real.
const NUEVO = "::nuevo::";

interface SelectorCatalogoProps {
  catalogo: Catalogo;
  valor: string;
  opciones: string[];
  onChange: (valor: string) => void;
  /** Se llama tras dar de alta, para que el padre recargue el catálogo. */
  onAgregado: () => void | Promise<void>;
  placeholder: string;
  error?: string;
}

/**
 * Desplegable con las entradas del catálogo más una opción para dar de alta una
 * nueva sin salir de la venta.
 *
 * Elegir de una lista evita los errores de dedo que ensucian el catálogo, pero
 * un desplegable a secas dejaría atorado a quien necesita capturar un valor que
 * todavía no existe. De ahí la opción de agregar aquí mismo.
 */
export default function SelectorCatalogo({
  catalogo,
  valor,
  opciones,
  onChange,
  onAgregado,
  placeholder,
  error,
}: SelectorCatalogoProps) {
  const [agregando, setAgregando] = useState(false);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Si el valor guardado ya no está en el catálogo —porque se borró de Ajustes
  // después de registrar la venta— igual se muestra. Si no, editar esa nota lo
  // cambiaría solo, sin que el usuario lo pidiera.
  const opcionesVisibles =
    valor && !opciones.includes(valor) ? [valor, ...opciones] : opciones;

  async function confirmarAlta() {
    const limpio = texto.trim();
    if (!limpio) return;

    setGuardando(true);
    setErrorAlta(null);
    try {
      const normalizado = await agregarEntradaCatalogo(catalogo, limpio);
      await onAgregado();
      onChange(normalizado);
      setAgregando(false);
      setTexto("");
    } catch (err) {
      console.error(err);
      setErrorAlta(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  function cancelarAlta() {
    setAgregando(false);
    setTexto("");
    setErrorAlta(null);
  }

  if (agregando) {
    return (
      <div className="field">
        <div className={styles.altaFila}>
          <input
            ref={inputRef}
            className="input"
            placeholder={`Nuevo: ${placeholder.toLowerCase()}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter guarda y Escape cancela, sin tocar el formulario de venta.
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void confirmarAlta();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelarAlta();
              }
            }}
            autoFocus
            disabled={guardando}
          />
          <button
            type="button"
            className={styles.altaBtn}
            onClick={() => void confirmarAlta()}
            disabled={guardando || !texto.trim()}
            title="Guardar"
            aria-label="Guardar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.altaBtn}
            onClick={cancelarAlta}
            disabled={guardando}
            title="Cancelar"
            aria-label="Cancelar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        {errorAlta && <span className={styles.errorText}>{errorAlta}</span>}
      </div>
    );
  }

  return (
    <div className="field">
      <select
        className={`select ${error ? "input-error" : ""}`}
        value={valor}
        onChange={(e) => {
          if (e.target.value === NUEVO) {
            setAgregando(true);
            return;
          }
          onChange(e.target.value);
        }}
        aria-label={placeholder}
      >
        <option value="">{placeholder}</option>
        {opcionesVisibles.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={NUEVO}>+ Agregar nuevo…</option>
      </select>
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  );
}
