import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  CLAVE_MANEJA_TIPOS,
  leerConfiguracion,
  guardarConfiguracion,
  baseTieneDatos,
} from "../db/database";
import Bienvenida from "../pages/Bienvenida";
import styles from "./ConfiguracionContext.module.css";

interface ConfiguracionValue {
  /** Si el negocio maneja varios tipos de hilo (encerado, algodón, etc.). */
  manejaTipos: boolean;
  guardarManejaTipos: (valor: boolean) => Promise<void>;
}

const ConfiguracionContext = createContext<ConfiguracionValue | null>(null);

export function useConfiguracion(): ConfiguracionValue {
  const valor = useContext(ConfiguracionContext);
  if (!valor) {
    throw new Error("useConfiguracion debe usarse dentro de <ConfiguracionProvider>");
  }
  return valor;
}

type Estado = "cargando" | "sin-configurar" | "listo" | "error";

/**
 * Además de proveer la configuración, hace de puerta: mientras no se sepa si el
 * negocio maneja varios tipos de hilo, no se pinta el resto de la app.
 *
 * El asistente vive aquí y no en el router a propósito: no debe tener URL
 * propia ni barra lateral, y no es un lugar al que se pueda navegar.
 */
export function ConfiguracionProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [manejaTipos, setManejaTipos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    detectar();
  }, []);

  async function detectar() {
    try {
      const valor = await leerConfiguracion(CLAVE_MANEJA_TIPOS);

      if (valor !== null) {
        setManejaTipos(valor === "si");
        setEstado("listo");
        return;
      }

      // No hay preferencia guardada. Si la base ya trae clientes o ventas, es
      // una instalación anterior a esta versión: se asume un solo tipo de hilo,
      // que es exactamente como venía funcionando, y no se le interrumpe con un
      // asistente de bienvenida.
      if (await baseTieneDatos()) {
        await guardarConfiguracion(CLAVE_MANEJA_TIPOS, "no");
        setManejaTipos(false);
        setEstado("listo");
        return;
      }

      setEstado("sin-configurar");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setEstado("error");
    }
  }

  async function guardarManejaTipos(valor: boolean) {
    await guardarConfiguracion(CLAVE_MANEJA_TIPOS, valor ? "si" : "no");
    setManejaTipos(valor);
    setEstado("listo");
  }

  if (estado === "cargando") {
    return <div className={styles.pantallaCompleta}>Preparando la aplicación...</div>;
  }

  if (estado === "error") {
    return (
      <div className={styles.pantallaCompleta}>
        <div className={styles.error}>
          <strong>No se pudo leer la configuración de la aplicación.</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (estado === "sin-configurar") {
    return <Bienvenida onElegir={guardarManejaTipos} />;
  }

  return (
    <ConfiguracionContext.Provider value={{ manejaTipos, guardarManejaTipos }}>
      {children}
    </ConfiguracionContext.Provider>
  );
}
