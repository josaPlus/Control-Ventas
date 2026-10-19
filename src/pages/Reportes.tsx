import { useState } from "react";
import {
  obtenerFilasReporteMensual,
  obtenerFilasReporteSemanal,
} from "../db/database";
import {
  exportarReporteMensual,
  exportarReporteSemanal,
} from "../lib/exportarReporte";
import {
  formatearFechaIso,
  lunesDeLaSemana,
  rangoSemanaLegible,
  sumarDias,
} from "../lib/semanas";
import styles from "./Reportes.module.css";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const CARPETA_DESTINO = "Documentos / Control de Ventas / Save";

// El año actual y los tres anteriores, del más reciente al más viejo.
function aniosDisponibles(): number[] {
  const actual = new Date().getFullYear();
  return [0, 1, 2, 3].map((i) => actual - i);
}

type Periodo = "mensual" | "semanal";

type Resultado =
  | { tipo: "exito"; archivo: string }
  | { tipo: "sin-datos"; periodo: string }
  | { tipo: "cancelado" }
  | { tipo: "error"; detalle: string };

export default function Reportes() {
  const ahora = new Date();
  const [periodo, setPeriodo] = useState<Periodo>("mensual");
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [anio, setAnio] = useState(ahora.getFullYear());
  // Se guarda siempre el lunes: el usuario elige cualquier día y lo
  // normalizamos, así el rango exportado nunca queda a media semana.
  const [lunes, setLunes] = useState(() =>
    lunesDeLaSemana(formatearFechaIso(ahora))
  );
  const [generando, setGenerando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const esSemanal = periodo === "semanal";
  const descripcionPeriodo = esSemanal
    ? `la semana del ${rangoSemanaLegible(lunes)}`
    : `${MESES[mes - 1]} de ${anio}`;

  function cambiar<T>(set: (valor: T) => void) {
    return (valor: T) => {
      set(valor);
      setResultado(null);
    };
  }

  async function exportar() {
    setGenerando(true);
    setResultado(null);
    try {
      // Se consulta antes de generar para no producir un Excel con solo
      // encabezados y que el usuario crea que perdió sus ventas.
      const filas = esSemanal
        ? await obtenerFilasReporteSemanal(lunes)
        : await obtenerFilasReporteMensual(anio, mes);
      if (filas.length === 0) {
        setResultado({ tipo: "sin-datos", periodo: descripcionPeriodo });
        return;
      }

      const { exportado, ruta } = esSemanal
        ? await exportarReporteSemanal(lunes)
        : await exportarReporteMensual(anio, mes);

      if (!exportado) {
        // El usuario dijo que no al diálogo de reemplazo. No es un error.
        setResultado({ tipo: "cancelado" });
        return;
      }

      setResultado({ tipo: "exito", archivo: ruta.split("/").pop() ?? ruta });
    } catch (err) {
      // La excepción cruda no le sirve a quien vende hilo; se registra en la
      // consola para diagnóstico y en pantalla va algo accionable.
      console.error(err);
      setResultado({
        tipo: "error",
        detalle:
          "No se pudo generar el reporte. Revisa que la carpeta " +
          CARPETA_DESTINO +
          " exista y que el archivo no esté abierto en Excel.",
      });
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Reportes</h1>
      <p className={styles.pageSubtitle}>
        Exporta a Excel todas las ventas de un mes o de una semana, con su
        detalle por línea.
      </p>

      <div className={`card ${styles.seccion}`}>
        <h3 className={styles.titulo}>
          {esSemanal ? "Reporte semanal" : "Reporte mensual"}
        </h3>
        <p className={styles.descripcion}>
          Se guarda en <strong>{CARPETA_DESTINO}</strong>. Si ya existe un
          reporte de ese periodo, se te preguntará antes de reemplazarlo.
        </p>

        <div className={styles.tabs} role="group" aria-label="Tipo de reporte">
          <button
            type="button"
            className={`${styles.tab} ${!esSemanal ? styles.tabActiva : ""}`}
            onClick={() => cambiar(setPeriodo)("mensual")}
            disabled={generando}
            aria-pressed={!esSemanal}
          >
            Mensual
          </button>
          <button
            type="button"
            className={`${styles.tab} ${esSemanal ? styles.tabActiva : ""}`}
            onClick={() => cambiar(setPeriodo)("semanal")}
            disabled={generando}
            aria-pressed={esSemanal}
          >
            Semanal
          </button>
        </div>

        <div className={styles.controles}>
          {esSemanal ? (
            <div className={`field ${styles.campoSemana}`}>
              <label className="field-label" htmlFor="semana">
                Semana (elige cualquier día de esa semana)
              </label>
              <input
                id="semana"
                type="date"
                className="input"
                value={lunes}
                onChange={(e) => {
                  if (!e.target.value) return;
                  cambiar(setLunes)(lunesDeLaSemana(e.target.value));
                }}
                disabled={generando}
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label className="field-label" htmlFor="mes">
                  Mes
                </label>
                <select
                  id="mes"
                  className="select"
                  value={mes}
                  onChange={(e) => cambiar(setMes)(Number(e.target.value))}
                  disabled={generando}
                >
                  {MESES.map((nombre, i) => (
                    <option key={nombre} value={i + 1}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="anio">
                  Año
                </label>
                <select
                  id="anio"
                  className="select"
                  value={anio}
                  onChange={(e) => cambiar(setAnio)(Number(e.target.value))}
                  disabled={generando}
                >
                  {aniosDisponibles().map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            type="button"
            className={`btn btn-primary ${styles.exportarBtn}`}
            onClick={exportar}
            disabled={generando}
          >
            {generando ? "Generando..." : "Exportar reporte"}
          </button>
        </div>

        {esSemanal && (
          <div className={styles.rangoSemana}>
            {/* El usuario elige un día suelto; se le confirma qué rango
                completo se va a exportar. */}
            Se exportará del <strong>{rangoSemanaLegible(lunes)}</strong>{" "}
            (lunes a domingo).
            <button
              type="button"
              className={styles.enlaceSemana}
              onClick={() => cambiar(setLunes)(sumarDias(lunes, -7))}
              disabled={generando}
            >
              ← Semana anterior
            </button>
            <button
              type="button"
              className={styles.enlaceSemana}
              onClick={() => cambiar(setLunes)(sumarDias(lunes, 7))}
              disabled={generando}
            >
              Semana siguiente →
            </button>
          </div>
        )}

        {resultado?.tipo === "exito" && (
          <div className={`${styles.aviso} ${styles.avisoExito}`}>
            <strong>Reporte generado.</strong>
            <span>
              Se guardó <strong>{resultado.archivo}</strong> en {CARPETA_DESTINO}.
            </span>
          </div>
        )}

        {resultado?.tipo === "sin-datos" && (
          <div className={`${styles.aviso} ${styles.avisoNeutral}`}>
            <strong>No hay ventas registradas en {resultado.periodo}.</strong>
            <span>
              No se generó ningún archivo. Elige otro periodo o registra ventas
              primero.
            </span>
          </div>
        )}

        {resultado?.tipo === "cancelado" && (
          <div className={`${styles.aviso} ${styles.avisoNeutral}`}>
            <span>
              No se reemplazó el reporte anterior. El archivo que ya tenías sigue
              intacto.
            </span>
          </div>
        )}

        {resultado?.tipo === "error" && (
          <div className={`${styles.aviso} ${styles.avisoError}`}>
            <strong>No se pudo exportar.</strong>
            <span>{resultado.detalle}</span>
          </div>
        )}
      </div>
    </div>
  );
}
