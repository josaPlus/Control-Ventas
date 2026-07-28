import { useEffect, useState } from "react";
import {
  type Catalogo,
  leerCatalogo,
  agregarEntradaCatalogo,
  contarUsoEnVentas,
  renombrarEntradaCatalogo,
  eliminarEntradaCatalogo,
} from "../db/database";
import Modal from "./Modal";
import ConfirmDialog from "./ConfirmDialog";
import { IconPencil, IconTrash } from "./Icons";
import styles from "./CatalogoEditor.module.css";

interface CatalogoEditorProps {
  catalogo: Catalogo;
  titulo: string;
  descripcion: string;
  /** Singular, para los textos de los diálogos: "color", "tipo de hilo". */
  singular: string;
}

/**
 * Lista editable de un catálogo. Es genérico a propósito: colores y tipos de
 * hilo tienen exactamente la misma forma y no vale la pena duplicar la pantalla.
 *
 * Estas listas se llenan solas al vender; aquí solo se corrige lo que entró mal
 * escrito, que con captura de texto libre pasa tarde o temprano.
 */
export default function CatalogoEditor({
  catalogo,
  titulo,
  descripcion,
  singular,
}: CatalogoEditorProps) {
  const [entradas, setEntradas] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [renombrando, setRenombrando] = useState<{ nombre: string; usos: number } | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [borrando, setBorrando] = useState<{ nombre: string; usos: number } | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [nombreAlta, setNombreAlta] = useState("");

  useEffect(() => {
    cargar();
  }, [catalogo]);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      setEntradas(await leerCatalogo(catalogo));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }

  // El conteo de usos se pide al abrir el diálogo, no al pintar la lista: son
  // N consultas y en la lista completa no aportan nada.
  async function abrirRenombrar(nombre: string) {
    setAviso(null);
    const usos = await contarUsoEnVentas(catalogo, nombre).catch(() => 0);
    setRenombrando({ nombre, usos });
    setNombreNuevo(nombre);
  }

  async function abrirBorrar(nombre: string) {
    setAviso(null);
    const usos = await contarUsoEnVentas(catalogo, nombre).catch(() => 0);
    setBorrando({ nombre, usos });
  }

  async function confirmarAlta() {
    setGuardando(true);
    setError(null);
    try {
      const normalizado = await agregarEntradaCatalogo(catalogo, nombreAlta);
      setAgregando(false);
      setNombreAlta("");
      setAviso(`"${normalizado}" ya está disponible al capturar ventas.`);
      await cargar();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  function cerrarAlta() {
    setAgregando(false);
    setNombreAlta("");
    setError(null);
  }

  // El error se limpia al cerrar: si no, un fallo de renombrado se quedaría
  // colgado abajo de la lista después de cerrar el modal.
  function cerrarRenombrar() {
    setRenombrando(null);
    setError(null);
  }

  async function confirmarRenombre() {
    if (!renombrando) return;
    setGuardando(true);
    setError(null);
    try {
      const lineas = await renombrarEntradaCatalogo(catalogo, renombrando.nombre, nombreNuevo);
      setRenombrando(null);
      setAviso(
        lineas > 0
          ? `Listo. Se actualizaron ${lineas} ${lineas === 1 ? "línea" : "líneas"} de venta.`
          : "Listo. Ninguna venta usaba ese valor."
      );
      await cargar();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  // El error se propaga para que lo muestre el propio diálogo.
  async function confirmarBorrado() {
    await eliminarEntradaCatalogo(catalogo, borrando!.nombre);
    setBorrando(null);
    setAviso("Entrada eliminada de las sugerencias.");
    await cargar();
  }

  return (
    <div className={`card ${styles.seccion}`}>
      <div className={styles.encabezado}>
        <div>
          <h3 className={styles.titulo}>{titulo}</h3>
          <p className={styles.descripcion}>{descripcion}</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setAviso(null);
            setAgregando(true);
          }}
        >
          + Agregar
        </button>
      </div>

      {cargando && <div className={styles.vacio}>Cargando...</div>}

      {!cargando && entradas.length === 0 && (
        <div className={styles.vacio}>
          Todavía no hay nada aquí. La lista se llena sola conforme registres ventas.
        </div>
      )}

      {!cargando && entradas.length > 0 && (
        <ul className={styles.lista}>
          {entradas.map((nombre) => (
            <li key={nombre} className={styles.fila}>
              <span className={styles.nombre}>{nombre}</span>
              <div className={styles.acciones}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => abrirRenombrar(nombre)}
                  title={`Renombrar ${nombre}`}
                  aria-label={`Renombrar ${nombre}`}
                >
                  <IconPencil />
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  onClick={() => abrirBorrar(nombre)}
                  title={`Eliminar ${nombre}`}
                  aria-label={`Eliminar ${nombre}`}
                >
                  <IconTrash />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {aviso && <div className={styles.aviso}>{aviso}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {agregando && (
        <Modal title={`Agregar ${singular}`} onClose={cerrarAlta}>
          <div className="field">
            <label className="field-label" htmlFor="nombre-alta">
              Nombre
            </label>
            <input
              id="nombre-alta"
              className="input"
              value={nombreAlta}
              onChange={(e) => setNombreAlta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nombreAlta.trim()) void confirmarAlta();
              }}
              autoFocus
            />
          </div>

          <p className={styles.explicacion}>
            Si ya existe con otras mayúsculas o acentos, no se duplica: se
            reutiliza la entrada que ya está.
          </p>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.modalAcciones}>
            <button type="button" className="btn btn-secondary" onClick={cerrarAlta} disabled={guardando}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void confirmarAlta()}
              disabled={guardando || !nombreAlta.trim()}
            >
              {guardando ? "Guardando..." : "Agregar"}
            </button>
          </div>
        </Modal>
      )}

      {renombrando && (
        <Modal title={`Renombrar ${singular}`} onClose={cerrarRenombrar}>
          <div className="field">
            <label className="field-label" htmlFor="nombre-catalogo">
              Nombre
            </label>
            <input
              id="nombre-catalogo"
              className="input"
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              autoFocus
            />
          </div>

          <p className={styles.explicacion}>
            {renombrando.usos > 0 ? (
              <>
                Este {singular} se usa en <strong>{renombrando.usos}</strong>{" "}
                {renombrando.usos === 1 ? "línea de venta" : "líneas de venta"}. Se
                actualizarán también, para que el historial y las gráficas no lo
                sigan mostrando con el nombre viejo.
              </>
            ) : (
              <>Ninguna venta usa este {singular} todavía.</>
            )}
          </p>

          <p className={styles.explicacion}>
            Si el nombre nuevo ya existe en la lista, las dos entradas se fusionan
            en una sola.
          </p>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.modalAcciones}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={cerrarRenombrar}
              disabled={guardando}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={confirmarRenombre}
              disabled={guardando || !nombreNuevo.trim()}
            >
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </Modal>
      )}

      {borrando && (
        <ConfirmDialog
          title={`¿Eliminar "${borrando.nombre}"?`}
          message={
            <>
              Deja de aparecer como sugerencia al capturar ventas.
              {borrando.usos > 0 && (
                <>
                  {" "}
                  Las <strong>{borrando.usos}</strong>{" "}
                  {borrando.usos === 1 ? "línea de venta que lo usa" : "líneas de venta que lo usan"}{" "}
                  no se tocan: conservan su texto y siguen apareciendo en el historial.
                </>
              )}{" "}
              Si vuelves a escribirlo en una venta, se dará de alta otra vez.
            </>
          }
          confirmLabel="Eliminar"
          tono="peligro"
          onConfirm={confirmarBorrado}
          onCancel={() => setBorrando(null)}
        />
      )}
    </div>
  );
}
