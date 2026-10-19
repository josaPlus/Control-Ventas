import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useConfiguracion } from "../context/ConfiguracionContext";
import {
  type DatosNegocio,
  type DatosPagare,
  CLAVE_FOLIO_INICIAL,
  contarLineasConTipoHilo,
  guardarFolioInicial,
  leerConfiguracion,
  leerDatosNegocio,
  guardarDatosNegocio,
  leerLogoNegocio,
  guardarLogoNegocio,
  quitarLogoNegocio,
  leerDatosPagare,
  guardarDatosPagare,
  obtenerNumeracionNotas,
  type NumeracionNotas,
} from "../db/database";
import {
  ErrorLogo,
  LOGO_ANCHO_MM,
  medidasLogoEnNota,
  prepararLogo,
} from "../lib/logoNegocio";
import AdopcionDatosLocales from "../components/AdopcionDatosLocales";
import SincronizacionServidor from "../components/SincronizacionServidor";
import CatalogoEditor from "../components/CatalogoEditor";
import ConfirmDialog from "../components/ConfirmDialog";
import styles from "./Ajustes.module.css";

const NEGOCIO_VACIO: DatosNegocio = { nombre: "", domicilio: "", telefono: "" };

// Ancho en pantalla del recuadro de vista previa; debe coincidir con .logoMarco.
// Con él se pasa de mm a px, para que el logo se vea del mismo tamaño relativo
// que tendrá en la nota.
const ANCHO_VISTA_PREVIA_PX = 240;
const PX_POR_MM = ANCHO_VISTA_PREVIA_PX / LOGO_ANCHO_MM;

type MedidasLogo = ReturnType<typeof medidasLogoEnNota>;

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

  const [logo, setLogo] = useState<string | null>(null);
  const [procesandoLogo, setProcesandoLogo] = useState(false);
  const [avisoLogo, setAvisoLogo] = useState<string | null>(null);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const [confirmandoQuitarLogo, setConfirmandoQuitarLogo] = useState(false);
  const [medidasLogo, setMedidasLogo] = useState<MedidasLogo | null>(null);
  // Solo para pintar el aviso de guardado como advertencia y no como éxito.
  const [logoPequeno, setLogoPequeno] = useState(false);
  const inputLogoRef = useRef<HTMLInputElement>(null);

  // Las medidas salen de la imagen ya guardada, con la misma función que usa
  // el PDF, así que la vista previa no puede mostrar algo distinto a la nota.
  useEffect(() => {
    setMedidasLogo(null);
    if (!logo) return;
    let vigente = true;
    const img = new Image();
    img.onload = () => {
      if (vigente) setMedidasLogo(medidasLogoEnNota(img.naturalWidth, img.naturalHeight));
    };
    img.src = logo;
    return () => {
      vigente = false;
    };
  }, [logo]);

  useEffect(() => {
    leerDatosNegocio()
      .then(setNegocio)
      .catch((err) => console.error(err));
    leerLogoNegocio()
      .then(setLogo)
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

  // El logo se guarda en cuanto se elige, aparte del botón "Guardar datos": no
  // hay nada que escribir ni corregir antes, así que pedir un segundo clic solo
  // sería una forma de perder el cambio.
  async function elegirLogo(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    // Sin esto, elegir otra vez el mismo archivo no dispararía onChange.
    e.target.value = "";
    if (!archivo) return;

    setProcesandoLogo(true);
    setAvisoLogo(null);
    setErrorLogo(null);
    setLogoPequeno(false);
    try {
      const { dataUrl, pequena } = await prepararLogo(archivo);
      await guardarLogoNegocio(dataUrl);
      setLogo(dataUrl);
      setAvisoLogo(
        pequena
          ? "Logo guardado, pero la imagen es pequeña: se suavizó para que no se vea pixeleada y puede salir más chica en la nota. Si tienes una versión más grande, úsala."
          : "Logo guardado. Aparecerá en las notas de remisión que generes a partir de ahora."
      );
      setLogoPequeno(pequena);
    } catch (err) {
      console.error(err);
      setErrorLogo(
        err instanceof ErrorLogo ? err.message : "No se pudo guardar el logo. Intenta de nuevo."
      );
    } finally {
      setProcesandoLogo(false);
    }
  }

  async function confirmarQuitarLogo() {
    await quitarLogoNegocio();
    setLogo(null);
    setConfirmandoQuitarLogo(false);
    setErrorLogo(null);
    setLogoPequeno(false);
    setAvisoLogo("Se quitó el logo. Las notas nuevas saldrán sin él.");
  }

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

        <div className={styles.logoSeccion}>
          <span className="field-label">Logo</span>
          <p className={styles.logoAyuda}>
            Aparece en la esquina superior izquierda de la nota y se ajusta solo
            al espacio, sin deformarse. PNG, JPG o WEBP, hasta 5 MB.
          </p>

          <div className={styles.logoFila}>
            <div className={styles.logoMarco}>
              {logo ? (
                <img
                  src={logo}
                  alt="Logo del negocio"
                  className={styles.logoImagen}
                  style={
                    medidasLogo
                      ? {
                          width: medidasLogo.ancho * PX_POR_MM,
                          height: medidasLogo.alto * PX_POR_MM,
                        }
                      : { visibility: "hidden" }
                  }
                />
              ) : (
                <span className={styles.logoVacio}>Sin logo</span>
              )}
            </div>

            <div className={styles.logoBotones}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => inputLogoRef.current?.click()}
                disabled={procesandoLogo}
              >
                {procesandoLogo ? "Procesando..." : logo ? "Cambiar imagen" : "Elegir imagen"}
              </button>
              {logo && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfirmandoQuitarLogo(true)}
                  disabled={procesandoLogo}
                >
                  Quitar
                </button>
              )}
            </div>

            <input
              ref={inputLogoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={elegirLogo}
              hidden
            />
          </div>

          {medidasLogo?.reducido && (
            <p className={styles.logoNotaTamano}>
              Por su resolución se imprimirá a {medidasLogo.ancho.toFixed(0)} ×{" "}
              {medidasLogo.alto.toFixed(0)} mm, más chico que el espacio, para que
              no se vea borroso.
            </p>
          )}

          {avisoLogo && (
            <div className={logoPequeno ? styles.avisoAdvertencia : styles.avisoExito}>
              {avisoLogo}
            </div>
          )}
          {errorLogo && <div className={styles.avisoError}>{errorLogo}</div>}
        </div>
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

      {confirmandoQuitarLogo && (
        <ConfirmDialog
          title="¿Quitar el logo?"
          message={
            <>
              Las notas de remisión que generes a partir de ahora saldrán sin logo.
              Las que ya guardaste no cambian. Para volver a ponerlo tendrás que
              elegir la imagen otra vez.
            </>
          }
          confirmLabel="Quitar"
          tono="peligro"
          onConfirm={confirmarQuitarLogo}
          onCancel={() => setConfirmandoQuitarLogo(false)}
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
