import { useEffect, useState } from "react";
import { useConfiguracion } from "../context/ConfiguracionContext";
import {
  type DatosNegocio,
  type DatosPagare,
  contarLineasConTipoHilo,
  leerDatosNegocio,
  guardarDatosNegocio,
  leerDatosPagare,
  guardarDatosPagare,
} from "../db/database";
import CatalogoEditor from "../components/CatalogoEditor";
import ConfirmDialog from "../components/ConfirmDialog";
import styles from "./Ajustes.module.css";

const NEGOCIO_VACIO: DatosNegocio = { nombre: "", domicilio: "", telefono: "" };

export default function Ajustes() {
  const { manejaTipos, guardarManejaTipos } = useConfiguracion();
  const [confirmando, setConfirmando] = useState<{ nuevoValor: boolean; lineas: number } | null>(
    null
  );

  const [negocio, setNegocio] = useState<DatosNegocio>(NEGOCIO_VACIO);
  const [guardandoNegocio, setGuardandoNegocio] = useState(false);
  const [avisoNegocio, setAvisoNegocio] = useState<string | null>(null);
  const [errorNegocio, setErrorNegocio] = useState<string | null>(null);

  const [pagare, setPagare] = useState<DatosPagare>({
    activo: false,
    beneficiario: "",
    ciudad: "",
    interes: "5",
    dias: "30",
  });
  const [guardandoPagare, setGuardandoPagare] = useState(false);
  const [avisoPagare, setAvisoPagare] = useState<string | null>(null);

  useEffect(() => {
    leerDatosNegocio()
      .then(setNegocio)
      .catch((err) => console.error(err));
    leerDatosPagare()
      .then(setPagare)
      .catch((err) => console.error(err));
  }, []);

  async function guardarPagare() {
    setGuardandoPagare(true);
    setAvisoPagare(null);
    try {
      await guardarDatosPagare(pagare);
      setAvisoPagare("Datos del pagaré guardados.");
    } catch (err) {
      console.error(err);
      setAvisoPagare("No se pudieron guardar. Intenta de nuevo.");
    } finally {
      setGuardandoPagare(false);
    }
  }

  function actualizarPagare(campo: keyof DatosPagare, valor: string | boolean) {
    setPagare((prev) => ({ ...prev, [campo]: valor }));
    setAvisoPagare(null);
  }

  async function guardarNegocio() {
    setGuardandoNegocio(true);
    setAvisoNegocio(null);
    setErrorNegocio(null);
    try {
      await guardarDatosNegocio(negocio);
      setAvisoNegocio("Datos guardados. Ya aparecerán en las notas de remisión.");
    } catch (err) {
      console.error(err);
      setErrorNegocio("No se pudieron guardar los datos. Intenta de nuevo.");
    } finally {
      setGuardandoNegocio(false);
    }
  }

  function actualizarNegocio(campo: keyof DatosNegocio, valor: string) {
    setNegocio((prev) => ({ ...prev, [campo]: valor }));
    setAvisoNegocio(null);
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
        <h3 className={styles.titulo}>Datos de tu negocio</h3>
        <p className={styles.descripcion}>
          Aparecen en el encabezado de las notas de remisión, para que el cliente
          sepa quién le vendió. Se capturan una sola vez.
        </p>

        <div className={styles.camposNegocio}>
          <div className="field">
            <label className="field-label" htmlFor="negocio-nombre">
              Nombre del negocio
            </label>
            <input
              id="negocio-nombre"
              className="input"
              placeholder="Ej. Hilos y Piñas del Bajío"
              value={negocio.nombre}
              onChange={(e) => actualizarNegocio("nombre", e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="negocio-domicilio">
              Domicilio
            </label>
            <input
              id="negocio-domicilio"
              className="input"
              placeholder="Calle, número, colonia, ciudad"
              value={negocio.domicilio}
              onChange={(e) => actualizarNegocio("domicilio", e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="negocio-telefono">
              Teléfono
            </label>
            <input
              id="negocio-telefono"
              className="input"
              placeholder="10 dígitos"
              value={negocio.telefono}
              onChange={(e) => actualizarNegocio("telefono", e.target.value)}
            />
          </div>
        </div>

        <div className={styles.accionesNegocio}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={guardarNegocio}
            disabled={guardandoNegocio}
          >
            {guardandoNegocio ? "Guardando..." : "Guardar datos"}
          </button>
        </div>

        {avisoNegocio && <div className={styles.avisoExito}>{avisoNegocio}</div>}
        {errorNegocio && <div className={styles.avisoError}>{errorNegocio}</div>}
      </div>

      <div className={`card ${styles.seccion}`}>
        <h3 className={styles.titulo}>Pagaré en las notas de remisión</h3>
        <p className={styles.descripcion}>
          Agrega al pie de la nota el texto de reconocimiento de deuda y la firma
          del deudor, con la fecha de vencimiento calculada. <strong>Solo
          aparece en las ventas que no están pagadas</strong>: en una venta
          liquidada no hay nada que deber.
        </p>

        <label className={styles.interruptorPagare}>
          <input
            type="checkbox"
            checked={pagare.activo}
            onChange={(e) => actualizarPagare("activo", e.target.checked)}
          />
          Incluir el pagaré en las notas
        </label>

        {pagare.activo && (
          <>
            <div className={styles.camposNegocio}>
              <div className="field">
                <label className="field-label" htmlFor="pagare-beneficiario">
                  A la orden de
                </label>
                <input
                  id="pagare-beneficiario"
                  className="input"
                  placeholder="Nombre completo de quien cobra"
                  value={pagare.beneficiario}
                  onChange={(e) => actualizarPagare("beneficiario", e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="pagare-ciudad">
                  Ciudad de pago
                </label>
                <input
                  id="pagare-ciudad"
                  className="input"
                  placeholder="Ej. León, Gto."
                  value={pagare.ciudad}
                  onChange={(e) => actualizarPagare("ciudad", e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="pagare-dias">
                  Días de plazo
                </label>
                <input
                  id="pagare-dias"
                  className="input"
                  type="number"
                  min={1}
                  value={pagare.dias}
                  onChange={(e) => actualizarPagare("dias", e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="pagare-interes">
                  Interés moratorio mensual (%)
                </label>
                <input
                  id="pagare-interes"
                  className="input"
                  type="number"
                  min={0}
                  step={0.5}
                  value={pagare.interes}
                  onChange={(e) => actualizarPagare("interes", e.target.value)}
                />
              </div>
            </div>

            <p className={styles.nota}>
              El texto cita el Artículo 11 de la Ley General de Títulos y
              Operaciones de Crédito. Es un título de crédito: revisa con quien te
              asesore que el contenido y el beneficiario sean los correctos.
            </p>
          </>
        )}

        <div className={styles.accionesNegocio}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={guardarPagare}
            disabled={guardandoPagare}
          >
            {guardandoPagare ? "Guardando..." : "Guardar pagaré"}
          </button>
        </div>

        {avisoPagare && <div className={styles.avisoExito}>{avisoPagare}</div>}
      </div>

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
    </div>
  );
}
