import { useCallback, useEffect, useState } from "react";
import {
  contarPendientesSync,
  sincronizarAhora,
  totalPendiente,
  type PendientesSync,
  type ResumenSync,
} from "../db/auth";
import { useSesion } from "../context/SesionContext";
import styles from "./SincronizacionServidor.module.css";

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function describir(p: PendientesSync): string {
  const partes: string[] = [];
  if (p.clientes > 0) partes.push(plural(p.clientes, "cliente", "clientes"));
  if (p.notas_venta > 0) partes.push(plural(p.notas_venta, "venta", "ventas"));
  if (p.colores_hilo > 0) partes.push(plural(p.colores_hilo, "color", "colores"));
  if (p.tipos_hilo > 0) partes.push(plural(p.tipos_hilo, "tipo de hilo", "tipos de hilo"));
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

function describirResumen(r: ResumenSync): string {
  return describir({
    clientes: r.clientes,
    notas_venta: r.notas_venta,
    colores_hilo: r.colores_hilo,
    tipos_hilo: r.tipos_hilo,
  });
}

/**
 * Envío de lo capturado hacia el servidor.
 *
 * Solo sube. Lo que otra PC haya capturado no se baja todavía, así que esto no
 * es "sincronizar" en el sentido completo — por eso el botón dice "Enviar".
 *
 * Se pinta únicamente con sesión validada contra el servidor: sin token no hay
 * a qué cuenta colgar los datos, y en modo local el vendedor eligió quedarse
 * en su PC.
 */
export default function SincronizacionServidor() {
  const { usuario, conexion, revisionDatos } = useSesion();

  const [pendientes, setPendientes] = useState<PendientesSync | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resumen, setResumen] = useState<ResumenSync | null>(null);
  const [error, setError] = useState<string | null>(null);

  const conectado = conexion?.modo === "remoto";

  const refrescar = useCallback(() => {
    if (!usuario) return;
    contarPendientesSync()
      .then(setPendientes)
      .catch((err) => console.error("No se pudo contar lo pendiente:", err));
  }, [usuario]);

  // revisionDatos entra en las dependencias porque adoptar datos locales
  // cambia cuántas filas tienen dueño, y por tanto cuántas hay que enviar.
  useEffect(refrescar, [refrescar, revisionDatos]);

  async function enviar() {
    setEnviando(true);
    setError(null);
    setResumen(null);
    try {
      const nuevo = await sincronizarAhora();
      setResumen(nuevo);
      refrescar();
    } catch (err) {
      // Los mensajes de Rust ya vienen redactados para el usuario final.
      console.error(err);
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setEnviando(false);
    }
  }

  if (!usuario) return null;

  const total = pendientes ? totalPendiente(pendientes) : 0;

  return (
    <div className={`card ${styles.seccion}`}>
      <h3 className={styles.titulo}>Copia en el servidor</h3>

      {conectado ? (
        <p className={styles.descripcion}>
          Tus ventas se guardan primero en esta computadora. Desde aquí se envía
          una copia al servidor, asociada a tu cuenta.
        </p>
      ) : (
        <p className={styles.descripcion}>
          Esta sesión no está conectada al servidor, así que lo que captures se
          queda en esta computadora. Para enviar una copia, vuelve a iniciar
          sesión con el servidor encendido.
        </p>
      )}

      <div className={styles.estado}>
        {total > 0 ? (
          <>
            Falta enviar <strong>{describir(pendientes!)}</strong>.
          </>
        ) : (
          <>Todo lo tuyo ya está en el servidor.</>
        )}
      </div>

      <button
        type="button"
        className={`btn btn-primary ${styles.boton}`}
        onClick={enviar}
        disabled={enviando || !conectado || total === 0}
      >
        {enviando ? "Enviando..." : "Enviar al servidor"}
      </button>

      {resumen && (
        <div className={`${styles.aviso} ${styles.avisoExito}`}>
          <strong>
            {describirResumen(resumen)
              ? `Se enviaron ${describirResumen(resumen)}.`
              : "No había nada nuevo que enviar."}
          </strong>
          {resumen.problemas.length > 0 && (
            <>
              {/* Se listan una por una: son filas concretas que el servidor
                  rechazó y el usuario necesita saber cuáles. */}
              <span>El servidor no aceptó algunas cosas:</span>
              <ul className={styles.problemas}>
                {resumen.problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {error && (
        <div className={`${styles.aviso} ${styles.avisoError}`}>
          <strong>No se pudo enviar todo.</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
