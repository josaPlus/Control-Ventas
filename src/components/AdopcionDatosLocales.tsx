import { useEffect, useState } from "react";
import {
  adoptarDatosLocales,
  contarDatosLocales,
  type ConteoLocal,
  type ResumenAdopcion,
} from "../db/auth";
import { useSesion } from "../context/SesionContext";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./AdopcionDatosLocales.module.css";

/** "4 clientes, 2 notas de venta y 12 colores" — sin las partes en cero. */
function enumerar(partes: string[]): string {
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function describirConteo(conteo: ConteoLocal): string[] {
  const partes: string[] = [];
  if (conteo.clientes > 0) partes.push(plural(conteo.clientes, "cliente", "clientes"));
  if (conteo.notas_venta > 0)
    partes.push(plural(conteo.notas_venta, "nota de venta", "notas de venta"));
  if (conteo.colores_hilo > 0) partes.push(plural(conteo.colores_hilo, "color", "colores"));
  if (conteo.tipos_hilo > 0)
    partes.push(plural(conteo.tipos_hilo, "tipo de hilo", "tipos de hilo"));
  if (conteo.configuracion > 0) partes.push(plural(conteo.configuracion, "ajuste", "ajustes"));
  return partes;
}

function describirResumen(resumen: ResumenAdopcion): string[] {
  const partes: string[] = [];
  if (resumen.clientes > 0) partes.push(plural(resumen.clientes, "cliente", "clientes"));
  if (resumen.notas_venta > 0)
    partes.push(plural(resumen.notas_venta, "nota de venta", "notas de venta"));
  if (resumen.colores_hilo > 0) partes.push(plural(resumen.colores_hilo, "color", "colores"));
  if (resumen.tipos_hilo > 0)
    partes.push(plural(resumen.tipos_hilo, "tipo de hilo", "tipos de hilo"));
  if (resumen.configuracion > 0)
    partes.push(plural(resumen.configuracion, "ajuste", "ajustes"));
  return partes;
}

function totalDescartado(resumen: ResumenAdopcion): number {
  return (
    resumen.colores_hilo_descartados +
    resumen.tipos_hilo_descartados +
    resumen.configuracion_descartada
  );
}

/**
 * Ofrece asociar a la cuenta activa lo que quedó sin dueño: lo capturado antes
 * de que existiera el login, o mientras se trabajó sin iniciar sesión.
 *
 * Nunca ocurre solo al iniciar sesión — en una PC compartida, el primer login
 * se apropiaría de las ventas de otra persona. Tiene que pedirse desde aquí.
 */
export default function AdopcionDatosLocales() {
  const { usuario, refrescarDatos } = useSesion();

  const [conteo, setConteo] = useState<ConteoLocal | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [adoptando, setAdoptando] = useState(false);
  const [resumen, setResumen] = useState<ResumenAdopcion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!usuario) {
      setConteo(null);
      return;
    }
    contarDatosLocales()
      .then(setConteo)
      // Un fallo aquí solo significa que no se puede ofrecer la adopción; no
      // vale la pena romper toda la página de Ajustes por eso.
      .catch((err) => console.error("No se pudieron contar los datos locales:", err));
  }, [usuario?.id_usuario]);

  async function adoptar() {
    setConfirmando(false);
    setAdoptando(true);
    setError(null);
    try {
      const nuevo = await adoptarDatosLocales();
      setResumen(nuevo);
      setConteo(await contarDatosLocales());
      // Catálogos, sugerencias y configuración se acotan por sesión: hay que
      // avisarles que lo que estaban mostrando cambió de alcance.
      refrescarDatos();
    } catch (err) {
      // Incluye el caso "sin sesión", que no debería poder pasar desde aquí
      // (la sección no se pinta sin usuario) pero el backend igual lo valida.
      console.error(err);
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setAdoptando(false);
    }
  }

  // Sin sesión no hay a qué cuenta asociar nada.
  if (!usuario) return null;

  const partes = conteo ? describirConteo(conteo) : [];
  const hayAlgo = partes.length > 0;

  // Ni datos por adoptar ni un resultado que mostrar: la sección no aporta.
  if (!hayAlgo && !resumen && !error) return null;

  return (
    <div className={`card ${styles.seccion}`}>
      <h3 className={styles.titulo}>Datos de esta computadora</h3>

      {hayAlgo && (
        <>
          <p className={styles.descripcion}>
            Hay datos en esta computadora que no están asociados a ninguna
            cuenta: <strong>{enumerar(partes)}</strong>. Son de antes de que
            crearas tu usuario, o de cuando trabajaste sin iniciar sesión.
          </p>
          <p className={styles.descripcion}>
            Si los asocias a <strong>{usuario.nombre_usuario}</strong>, pasan a
            ser tuyos y se sincronizarán con tu cuenta cuando haya servidor. No
            se borra ni se pierde nada: solo cambian de dueño.
          </p>
          <button
            type="button"
            className={`btn btn-primary ${styles.boton}`}
            onClick={() => setConfirmando(true)}
            disabled={adoptando}
          >
            {adoptando ? "Asociando..." : "Asociar a mi cuenta"}
          </button>
        </>
      )}

      {resumen && (
        <div className={`${styles.aviso} ${styles.avisoExito}`}>
          <strong>
            {describirResumen(resumen).length > 0
              ? `Se asociaron ${enumerar(describirResumen(resumen))} a tu cuenta.`
              : "No había nada nuevo que asociar."}
          </strong>
          {totalDescartado(resumen) > 0 && (
            <span>
              {/* Pasa cuando el usuario ya tenía su propia entrada con ese
                  nombre: se conserva la suya y se descarta la copia local. */}
              Se descartaron {totalDescartado(resumen)}{" "}
              {totalDescartado(resumen) === 1 ? "entrada repetida" : "entradas repetidas"}{" "}
              porque ya las tenías en tu cuenta.
            </span>
          )}
        </div>
      )}

      {error && (
        <div className={`${styles.aviso} ${styles.avisoError}`}>
          <strong>No se pudieron asociar los datos.</strong>
          <span>{error}</span>
        </div>
      )}

      {confirmando && (
        <ConfirmDialog
          title="¿Asociar estos datos a tu cuenta?"
          message={
            <>
              <strong>{enumerar(partes)}</strong> pasarán a pertenecer a{" "}
              <strong>{usuario.nombre_usuario}</strong>. Nada se borra.
              <br />
              <br />
              Si alguna entrada de catálogo ya existe en tu cuenta con el mismo
              nombre, se conserva la tuya y se descarta la copia suelta.
            </>
          }
          confirmLabel="Asociar a mi cuenta"
          onConfirm={adoptar}
          onCancel={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}
