import { useEffect, useState } from "react";
import { useConfiguracion } from "../context/ConfiguracionContext";
import {
  CLAVE_FOLIO_INICIAL,
  contarLineasConTipoHilo,
  guardarFolioInicial,
  leerConfiguracion,
  obtenerNumeracionNotas,
  type NumeracionNotas,
} from "../db/database";
import AdopcionDatosLocales from "../components/AdopcionDatosLocales";
import SincronizacionServidor from "../components/SincronizacionServidor";
import CatalogoEditor from "../components/CatalogoEditor";
import ConfirmDialog from "../components/ConfirmDialog";
import styles from "./Ajustes.module.css";

// Mismo tope que FOLIO_MAXIMO en src-tauri/src/ventas.rs.
const FOLIO_MAXIMO = 999_999_999;

// Se valida aquí para avisar mientras se escribe; Rust vuelve a validar al
// guardar, así que esto es solo comodidad, no la protección.
function validarFolio(texto: string, numeracion: NumeracionNotas | null): string | null {
  if (!/^\d+$/.test(texto)) {
    return "Escribe solo números enteros, sin puntos ni letras.";
  }
  const valor = Number(texto);
  if (valor < 1 || valor > FOLIO_MAXIMO) {
    return `El número debe estar entre 1 y ${FOLIO_MAXIMO.toLocaleString("es-MX")}.`;
  }
  if (numeracion?.ultima != null && valor <= numeracion.ultima) {
    return `No se puede usar la nota #${valor} como inicio: ya existe una nota con ese número o uno mayor. La última es la #${numeracion.ultima}.`;
  }
  return null;
}

export default function Ajustes() {
  const { manejaTipos, guardarManejaTipos } = useConfiguracion();
  const [confirmando, setConfirmando] = useState<{ nuevoValor: boolean; lineas: number } | null>(
    null
  );

  const [numeracion, setNumeracion] = useState<NumeracionNotas | null>(null);
  const [folioGuardado, setFolioGuardado] = useState<string | null>(null);
  const [folioTexto, setFolioTexto] = useState("");
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [confirmandoFolio, setConfirmandoFolio] = useState<number | null>(null);

  useEffect(() => {
    cargarFolio();
  }, []);

  async function cargarFolio() {
    try {
      const [guardado, actual] = await Promise.all([
        leerConfiguracion(CLAVE_FOLIO_INICIAL),
        obtenerNumeracionNotas(),
      ]);
      setFolioGuardado(guardado);
      setFolioTexto(guardado ?? "");
      setNumeracion(actual);
      setErrorCarga(null);
    } catch (err) {
      console.error(err);
      setErrorCarga(err instanceof Error ? err.message : String(err));
    }
  }

  const folioLimpio = folioTexto.trim();
  const errorFolio = folioLimpio ? validarFolio(folioLimpio, numeracion) : null;
  const puedeGuardarFolio =
    numeracion !== null && folioLimpio !== "" && !errorFolio && folioLimpio !== folioGuardado;

  function pedirGuardarFolio() {
    if (!puedeGuardarFolio) return;
    setConfirmandoFolio(Number(folioLimpio));
  }

  async function confirmarFolio() {
    await guardarFolioInicial(confirmandoFolio!);
    setConfirmandoFolio(null);
    await cargarFolio();
  }

  async function pedirCambio(nuevoValor: boolean) {
    if (nuevoValor === manejaTipos) return;
    // Solo importa cuánto se pierde de vista al apagar; al encender no hay nada
    // que advertir más allá del campo nuevo.
    const lineas = nuevoValor ? 0 : await contarLineasConTipoHilo().catch(() => 0);
    setConfirmando({ nuevoValor, lineas });
  }

  async function confirmarCambio() {
    await guardarManejaTipos(confirmando!.nuevoValor);
    setConfirmando(null);
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Ajustes</h1>
      <p className={styles.pageSubtitle}>
        Configura cómo funciona la aplicación para tu negocio.
      </p>

      <div className={`card ${styles.seccion}`}>
        <h3 className={styles.titulo}>Tipos de hilo</h3>
        <p className={styles.descripcion}>
          Si manejas varios tipos de hilo (encerado, algodón, semi encerado…),
          cada línea de venta llevará además el tipo. Si vendes uno solo, el campo
          no aparece.
        </p>

        <div className={styles.opciones}>
          <button
            type="button"
            className={`${styles.opcion} ${!manejaTipos ? styles.opcionActiva : ""}`}
            onClick={() => pedirCambio(false)}
          >
            <span className={styles.opcionTitulo}>Un solo tipo de hilo</span>
            <span className={styles.opcionTexto}>Solo registras color, cantidad y precio.</span>
          </button>

          <button
            type="button"
            className={`${styles.opcion} ${manejaTipos ? styles.opcionActiva : ""}`}
            onClick={() => pedirCambio(true)}
          >
            <span className={styles.opcionTitulo}>Varios tipos de hilo</span>
            <span className={styles.opcionTexto}>Cada línea lleva también el tipo de hilo.</span>
          </button>
        </div>
      </div>

      <div className={`card ${styles.seccion}`}>
        <h3 className={styles.titulo}>Numeración de notas</h3>
        <p className={styles.descripcion}>
          Si ya llevabas notas en papel, indica desde qué número deben continuar.
          Las notas siguientes se numeran solas a partir de ahí.
        </p>

        <div className={`field ${styles.folioCampo}`}>
          <label className="field-label" htmlFor="folio-inicial">
            Empezar desde la nota
          </label>
          <div className={styles.folioFila}>
            <input
              id="folio-inicial"
              className={`input ${styles.folioInput} ${errorFolio ? "input-error" : ""}`}
              type="text"
              inputMode="numeric"
              placeholder="Ej. 3000"
              value={folioTexto}
              onChange={(e) => setFolioTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") pedirGuardarFolio();
              }}
              disabled={numeracion === null}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={pedirGuardarFolio}
              disabled={!puedeGuardarFolio}
            >
              Guardar
            </button>
          </div>
          {errorFolio && <span className="field-error">{errorFolio}</span>}
        </div>

        {numeracion && (
          <p className={styles.folioVistaPrevia}>
            La siguiente nota será la <strong>#{numeracion.siguiente}</strong>.
          </p>
        )}
        {errorCarga && (
          <p className={styles.folioErrorCarga}>
            No se pudo leer la numeración de notas: {errorCarga}
          </p>
        )}
      </div>

      {/* Se pinta sola solo si hay sesión y algo sin dueño que asociar. */}
      <AdopcionDatosLocales />

      {/* Va después de la adopción a propósito: primero se decide qué datos
          son tuyos, y solo entonces tiene sentido enviarlos. */}
      <SincronizacionServidor />

      <CatalogoEditor
        catalogo="colores_hilo"
        titulo="Colores de hilo"
        singular="color"
        descripcion="Sugerencias que aparecen al capturar una venta. Se agregan solas cuando escribes un color nuevo; aquí puedes corregir los que quedaron mal escritos."
      />

      {manejaTipos && (
        <CatalogoEditor
          catalogo="tipos_hilo"
          titulo="Tipos de hilo"
          singular="tipo de hilo"
          descripcion="Se llenan solos conforme registras ventas. Corrige aquí los que hayan entrado con un error de dedo."
        />
      )}

      {confirmando && (
        <ConfirmDialog
          title={
            confirmando.nuevoValor
              ? "¿Activar los tipos de hilo?"
              : "¿Dejar de usar tipos de hilo?"
          }
          message={
            confirmando.nuevoValor ? (
              <>
                A partir de ahora, cada línea de venta pedirá también el tipo de
                hilo, y será obligatorio. La lista de tipos se irá llenando sola
                conforme captures ventas.
              </>
            ) : (
              <>
                El campo dejará de aparecer al capturar ventas nuevas.
                {confirmando.lineas > 0 && (
                  <>
                    {" "}
                    Las <strong>{confirmando.lineas}</strong>{" "}
                    {confirmando.lineas === 1 ? "línea" : "líneas"} que ya lo tienen
                    no se borran y lo siguen mostrando en el historial.
                  </>
                )}{" "}
                Puedes volver a activarlo cuando quieras.
              </>
            )
          }
          confirmLabel={confirmando.nuevoValor ? "Activar" : "Desactivar"}
          onConfirm={confirmarCambio}
          onCancel={() => setConfirmando(null)}
        />
      )}

      {confirmandoFolio !== null && (
        <ConfirmDialog
          title="¿Cambiar el número de inicio?"
          message={
            <>
              La siguiente nota será la <strong>#{confirmandoFolio}</strong>. Una vez
              que guardes una nota con ese número, la numeración seguirá desde ahí y
              ya no podrás empezar desde un número menor.
            </>
          }
          confirmLabel="Guardar"
          onConfirm={confirmarFolio}
          onCancel={() => setConfirmandoFolio(null)}
        />
      )}
    </div>
  );
}
