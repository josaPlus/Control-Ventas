import { useState } from "react";
import styles from "./Bienvenida.module.css";

interface BienvenidaProps {
  onElegir: (manejaTipos: boolean) => Promise<void>;
}

/**
 * Se muestra una sola vez, en el primer arranque de una instalación nueva.
 *
 * La pregunta existe porque el campo "tipo de hilo" no se puede decidir solo:
 * si se mostrara únicamente cuando el catálogo de tipos ya tiene registros,
 * nunca habría manera de dar de alta el primero.
 */
export default function Bienvenida({ onElegir }: BienvenidaProps) {
  const [guardando, setGuardando] = useState<null | "uno" | "varios">(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir(manejaTipos: boolean) {
    setError(null);
    setGuardando(manejaTipos ? "varios" : "uno");
    try {
      await onElegir(manejaTipos);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setGuardando(null);
    }
  }

  return (
    <div className={styles.pantalla}>
      <div className={styles.contenido}>
        <span className={styles.icono} aria-hidden="true">
          <IconCarrete />
        </span>

        <h1 className={styles.titulo}>Control de Ventas</h1>
        <p className={styles.subtitulo}>
          Antes de empezar, cuéntanos cómo manejas tu mercancía. Esto ajusta el
          formulario de venta a tu negocio.
        </p>

        <div className={styles.opciones}>
          <button
            type="button"
            className={styles.opcion}
            onClick={() => elegir(false)}
            disabled={guardando !== null}
          >
            <span className={styles.opcionTitulo}>Un solo tipo de hilo</span>
            <span className={styles.opcionTexto}>
              Todo lo que vendes es del mismo tipo. En cada venta registras el
              color, la cantidad de piñas y el precio.
            </span>
            <span className={styles.opcionEstado}>
              {guardando === "uno" ? "Guardando..." : "Lo más común"}
            </span>
          </button>

          <button
            type="button"
            className={styles.opcion}
            onClick={() => elegir(true)}
            disabled={guardando !== null}
          >
            <span className={styles.opcionTitulo}>Varios tipos de hilo</span>
            <span className={styles.opcionTexto}>
              Manejas encerado, algodón, semi encerado u otros. Cada línea de
              venta lleva además el tipo de hilo.
            </span>
            <span className={styles.opcionEstado}>
              {guardando === "varios" ? "Guardando..." : "Agrega un campo más"}
            </span>
          </button>
        </div>

        {error && <div className={styles.error}>No se pudo guardar: {error}</div>}

        <p className={styles.nota}>
          Puedes cambiarlo cuando quieras desde Ajustes. No pierdes nada de lo
          que ya hayas registrado.
        </p>
      </div>
    </div>
  );
}

/* Misma piña de hilo que la barra lateral. */
function IconCarrete() {
  return (
    <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5 17 19H7L12 2.5Z" />
      <path d="M9.4 11h5.2" />
      <path d="M8.6 14h6.8" />
      <ellipse cx="12" cy="19.5" rx="5" ry="1.8" />
    </svg>
  );
}
