import { useEffect, useMemo, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { documentDir } from "@tauri-apps/api/path";
import { listarNotasVenta, leerDatosNegocio } from "../db/database";
import type { VentaConComprador } from "../lib/dashboardStats";
import { exportarNotaDeVenta, exportarNotaEnBlanco } from "../lib/exportarNotaRemision";
import { useConfiguracion } from "../context/ConfiguracionContext";
import { formatMoney, formatDateLong } from "../lib/format";
import styles from "./NotasRemision.module.css";

const CARPETA_DESTINO = "Documentos / Control de Ventas / Save / Notas";

type Resultado =
  | { tipo: "exito"; archivo: string; ruta: string }
  | { tipo: "cancelado" }
  | { tipo: "error"; detalle: string };

export default function NotasRemision() {
  const { manejaTipos } = useConfiguracion();

  const [notas, setNotas] = useState<VentaConComprador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState("");
  const [seleccionada, setSeleccionada] = useState<VentaConComprador | null>(null);

  const [generando, setGenerando] = useState<null | "venta" | "blanco">(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [faltanDatosNegocio, setFaltanDatosNegocio] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    try {
      const [lista, negocio] = await Promise.all([listarNotasVenta(), leerDatosNegocio()]);
      setNotas(lista);
      setFaltanDatosNegocio(!negocio.nombre.trim());
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }

  // Filtrado en cliente, igual que el Historial: el volumen de notas de este
  // negocio no justifica ir a la base en cada tecla.
  const filtradas = useMemo(() => {
    const busqueda = texto.trim().toLowerCase();
    const base = busqueda
      ? notas.filter(
          (n) =>
            n.comprador.toLowerCase().includes(busqueda) ||
            String(n.numero_nota).includes(busqueda)
        )
      : notas;
    // Sin búsqueda se muestran solo las más recientes para no pintar cientos.
    return busqueda ? base.slice(0, 30) : base.slice(0, 8);
  }, [notas, texto]);

  async function generarDeVenta() {
    if (!seleccionada) return;
    setGenerando("venta");
    setResultado(null);
    try {
      const { exportado, ruta } = await exportarNotaDeVenta(seleccionada.id!, manejaTipos);
      if (!exportado) {
        setResultado({ tipo: "cancelado" });
        return;
      }
      setResultado({ tipo: "exito", archivo: ruta.split("/").pop() ?? ruta, ruta });
    } catch (err) {
      console.error(err);
      setResultado({
        tipo: "error",
        detalle:
          "No se pudo generar la nota. Revisa que el archivo no esté abierto en otro programa.",
      });
    } finally {
      setGenerando(null);
    }
  }

  async function generarEnBlanco() {
    setGenerando("blanco");
    setResultado(null);
    try {
      const { ruta } = await exportarNotaEnBlanco(manejaTipos);
      setResultado({ tipo: "exito", archivo: ruta.split("/").pop() ?? ruta, ruta });
    } catch (err) {
      console.error(err);
      setResultado({
        tipo: "error",
        detalle:
          "No se pudo generar la nota en blanco. Revisa que el archivo no esté abierto en otro programa.",
      });
    } finally {
      setGenerando(null);
    }
  }

  // Abre el PDF en el visor del sistema, que es desde donde se imprime.
  async function abrir(ruta: string) {
    try {
      const documentos = await rutaDocumentos();
      await openPath(`${documentos}\\${ruta.replace(/\//g, "\\")}`);
    } catch (err) {
      console.error(err);
      setResultado({
        tipo: "error",
        detalle: `No se pudo abrir el archivo. Búscalo en ${CARPETA_DESTINO}.`,
      });
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Notas de remisión</h1>
      <p className={styles.pageSubtitle}>
        Genera la nota para entregar al cliente. Se imprime en la mitad de arriba
        de una hoja carta, para que la otra mitad sirva para otra nota.
      </p>

      {faltanDatosNegocio && (
        <div className={`${styles.aviso} ${styles.avisoNeutral}`}>
          <strong>Aún no has capturado los datos de tu negocio.</strong>
          <span>
            Las notas van a salir sin el nombre, domicilio ni teléfono de quien
            vende. Puedes capturarlos en Ajustes.
          </span>
        </div>
      )}

      <div className={`card ${styles.seccion}`}>
        <h3 className={styles.titulo}>Nota de una venta registrada</h3>
        <p className={styles.descripcion}>
          Se guarda en <strong>{CARPETA_DESTINO}</strong> con el nombre del
          cliente y el número de nota, para que la encuentres fácil.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="buscar-nota">
            Buscar por cliente o número de nota
          </label>
          <input
            id="buscar-nota"
            className="input"
            placeholder="Ej. cliente 1, o 5"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setSeleccionada(null);
              setResultado(null);
            }}
          />
        </div>

        {cargando && <div className={styles.vacio}>Cargando ventas...</div>}

        {!cargando && filtradas.length === 0 && (
          <div className={styles.vacio}>
            {texto
              ? "Ninguna venta coincide con esa búsqueda."
              : "Todavía no hay ventas registradas."}
          </div>
        )}

        {!cargando && filtradas.length > 0 && (
          <>
            {!texto && (
              <p className={styles.pista}>Ventas más recientes. Busca para ver otras.</p>
            )}
            <ul className={styles.lista}>
              {filtradas.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`${styles.opcion} ${
                      seleccionada?.id === n.id ? styles.opcionActiva : ""
                    }`}
                    onClick={() => {
                      setSeleccionada(n);
                      setResultado(null);
                    }}
                  >
                    <span className={styles.folio}>#{n.numero_nota}</span>
                    <span className={styles.comprador}>{n.comprador}</span>
                    <span className={styles.fecha}>{formatDateLong(n.fecha)}</span>
                    <span className={styles.total}>{formatMoney(n.total_venta)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className={styles.acciones}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={generarDeVenta}
            disabled={!seleccionada || generando !== null}
          >
            {generando === "venta" ? "Generando..." : "Generar nota"}
          </button>
          {!seleccionada && !cargando && notas.length > 0 && (
            <span className={styles.pista}>Elige una venta de la lista.</span>
          )}
        </div>
      </div>

      <div className={`card ${styles.seccion}`}>
        <h3 className={styles.titulo}>Nota en blanco</h3>
        <p className={styles.descripcion}>
          El formato impreso con los renglones vacíos, para llenar a mano cuando
          haga falta. No consume ningún número de nota.
        </p>
        <div className={styles.acciones}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={generarEnBlanco}
            disabled={generando !== null}
          >
            {generando === "blanco" ? "Generando..." : "Generar nota en blanco"}
          </button>
        </div>
      </div>

      {resultado?.tipo === "exito" && (
        <div className={`${styles.aviso} ${styles.avisoExito}`}>
          <strong>Nota generada.</strong>
          <span>
            Se guardó <strong>{resultado.archivo}</strong> en {CARPETA_DESTINO}.
          </span>
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${styles.abrirBtn}`}
            onClick={() => abrir(resultado.ruta)}
          >
            Abrir e imprimir
          </button>
        </div>
      )}

      {resultado?.tipo === "cancelado" && (
        <div className={`${styles.aviso} ${styles.avisoNeutral}`}>
          <span>No se reemplazó la nota anterior. El archivo que ya tenías sigue intacto.</span>
        </div>
      )}

      {resultado?.tipo === "error" && (
        <div className={`${styles.aviso} ${styles.avisoError}`}>
          <strong>No se pudo generar.</strong>
          <span>{resultado.detalle}</span>
        </div>
      )}
    </div>
  );
}

// openPath necesita la ruta absoluta; writeFile trabaja con rutas relativas a
// Documentos, así que hay que resolver la base.
async function rutaDocumentos(): Promise<string> {
  const dir = await documentDir();
  return dir.replace(/[\\/]+$/, "");
}
