import { useState } from "react";
import { useConfiguracion } from "../context/ConfiguracionContext";
import { contarLineasConTipoHilo } from "../db/database";
import CatalogoEditor from "../components/CatalogoEditor";
import ConfirmDialog from "../components/ConfirmDialog";
import styles from "./Ajustes.module.css";

export default function Ajustes() {
  const { manejaTipos, guardarManejaTipos } = useConfiguracion();
  const [confirmando, setConfirmando] = useState<{ nuevoValor: boolean; lineas: number } | null>(
    null
  );

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
