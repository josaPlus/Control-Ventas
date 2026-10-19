import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  type LadoLogo,
  guardarLogoNegocio,
  leerLogoNegocio,
  quitarLogoNegocio,
} from "../db/database";
import {
  ErrorLogo,
  LOGO_ANCHO_MM,
  medidasLogoEnNota,
  prepararLogo,
} from "../lib/logoNegocio";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./LogoNegocioEditor.module.css";

// Ancho en pantalla del recuadro de vista previa; debe coincidir con .marco.
// Con él se pasa de mm a px, para que el logo se vea del mismo tamaño relativo
// que tendrá en la nota.
const ANCHO_VISTA_PREVIA_PX = 240;
const PX_POR_MM = ANCHO_VISTA_PREVIA_PX / LOGO_ANCHO_MM;

type MedidasLogo = ReturnType<typeof medidasLogoEnNota>;

interface LogoNegocioEditorProps {
  lado: LadoLogo;
  titulo: string;
  ayuda: string;
}

/**
 * Vista previa, cambio y retiro de uno de los logos de la nota de remisión.
 * Ajustes usa uno por lado; cada uno lee y guarda solo el suyo.
 */
export default function LogoNegocioEditor({ lado, titulo, ayuda }: LogoNegocioEditorProps) {
  const [logo, setLogo] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);
  const [medidas, setMedidas] = useState<MedidasLogo | null>(null);
  // Solo para pintar el aviso de guardado como advertencia y no como éxito.
  const [pequeno, setPequeno] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    leerLogoNegocio(lado)
      .then(setLogo)
      .catch((err) => console.error(err));
  }, [lado]);

  // Las medidas salen de la imagen ya guardada, con la misma función que usa
  // el PDF, así que la vista previa no puede mostrar algo distinto a la nota.
  useEffect(() => {
    setMedidas(null);
    if (!logo) return;
    let vigente = true;
    const img = new Image();
    img.onload = () => {
      if (vigente) setMedidas(medidasLogoEnNota(img.naturalWidth, img.naturalHeight));
    };
    img.src = logo;
    return () => {
      vigente = false;
    };
  }, [logo]);

  // Se guarda en cuanto se elige, aparte del botón "Guardar datos": no hay
  // nada que escribir ni corregir antes, así que pedir un segundo clic solo
  // sería una forma de perder el cambio.
  async function elegir(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    // Sin esto, elegir otra vez el mismo archivo no dispararía onChange.
    e.target.value = "";
    if (!archivo) return;

    setProcesando(true);
    setAviso(null);
    setError(null);
    setPequeno(false);
    try {
      const { dataUrl, pequena } = await prepararLogo(archivo);
      await guardarLogoNegocio(lado, dataUrl);
      setLogo(dataUrl);
      setAviso(
        pequena
          ? "Logo guardado, pero la imagen es pequeña: se suavizó para que no se vea pixeleada y puede salir más chica en la nota. Si tienes una versión más grande, úsala."
          : "Logo guardado. Aparecerá en las notas de remisión que generes a partir de ahora."
      );
      setPequeno(pequena);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof ErrorLogo ? err.message : "No se pudo guardar el logo. Intenta de nuevo."
      );
    } finally {
      setProcesando(false);
    }
  }

  async function confirmarQuitar() {
    await quitarLogoNegocio(lado);
    setLogo(null);
    setConfirmandoQuitar(false);
    setError(null);
    setPequeno(false);
    setAviso("Se quitó el logo. Las notas nuevas saldrán sin él.");
  }

  return (
    <div className={styles.seccion}>
      <span className="field-label">{titulo}</span>
      <p className={styles.ayuda}>{ayuda}</p>

      <div className={styles.fila}>
        <div className={`${styles.marco} ${lado === "derecho" ? styles.marcoDerecho : ""}`}>
          {logo ? (
            <img
              src={logo}
              alt={titulo}
              className={styles.imagen}
              style={
                medidas
                  ? { width: medidas.ancho * PX_POR_MM, height: medidas.alto * PX_POR_MM }
                  : { visibility: "hidden" }
              }
            />
          ) : (
            <span className={styles.vacio}>Sin logo</span>
          )}
        </div>

        <div className={styles.botones}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={procesando}
          >
            {procesando ? "Procesando..." : logo ? "Cambiar imagen" : "Elegir imagen"}
          </button>
          {logo && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmandoQuitar(true)}
              disabled={procesando}
            >
              Quitar
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={elegir}
          hidden
        />
      </div>

      {medidas?.reducido && (
        <p className={styles.notaTamano}>
          Por su resolución se imprimirá a {medidas.ancho.toFixed(0)} ×{" "}
          {medidas.alto.toFixed(0)} mm, más chico que el espacio, para que no se
          vea borroso.
        </p>
      )}

      {aviso && <div className={pequeno ? styles.avisoAdvertencia : styles.avisoExito}>{aviso}</div>}
      {error && <div className={styles.avisoError}>{error}</div>}

      {confirmandoQuitar && (
        <ConfirmDialog
          title={`¿Quitar el ${titulo.toLowerCase()}?`}
          message={
            <>
              Las notas de remisión que generes a partir de ahora saldrán sin este
              logo. Las que ya guardaste no cambian. Para volver a ponerlo tendrás
              que elegir la imagen otra vez.
            </>
          }
          confirmLabel="Quitar"
          tono="peligro"
          onConfirm={confirmarQuitar}
          onCancel={() => setConfirmandoQuitar(false)}
        />
      )}
    </div>
  );
}
