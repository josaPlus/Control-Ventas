import { useState } from "react";
import { useSesion } from "../context/SesionContext";
import styles from "./Login.module.css";

type Modo = "entrar" | "crear";

/**
 * Mismo criterio laxo que `correo_valido` en src-tauri/src/auth.rs: algo antes
 * de la @, algo después, y un punto interior en el dominio.
 *
 * Se valida en los dos lados a propósito. Aquí para responder sin ir y volver
 * al backend; allá porque el comando es invocable por sí solo y no puede
 * confiar en que alguien ya haya filtrado.
 */
function correoValido(correo: string): boolean {
  const partes = correo.split("@");
  if (partes.length !== 2) return false;
  const [local, dominio] = partes;
  if (!local || dominio.startsWith(".") || dominio.endsWith(".")) return false;
  const punto = dominio.indexOf(".");
  return punto > 0 && punto < dominio.length - 1;
}

interface LoginProps {
  /** Volver a la app sin iniciar sesión. */
  onCancelar: () => void;
  onListo: () => void;
}

/**
 * Login local. No hay servidor todavía: el usuario y su contraseña viven en la
 * SQLite de esta PC.
 *
 * No es una puerta — se llega aquí a propósito desde la barra lateral, y
 * "Seguir sin iniciar sesión" siempre está disponible. Quien nunca haga login
 * usa la app igual que siempre.
 */
export default function Login({ onCancelar, onListo }: LoginProps) {
  const { iniciarSesion, registrarUsuario } = useSesion();

  const [modo, setModo] = useState<Modo>("entrar");
  // En "entrar" es el identificador (nombre o correo); en "crear" es solo el
  // nombre de usuario, y el correo va aparte.
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const creando = modo === "crear";

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    setError(null);
    setPassword("");
    setConfirmacion("");
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!nombre.trim()) {
      setError(
        creando ? "Escribe tu nombre de usuario." : "Ingresa tu usuario o correo."
      );
      return;
    }
    if (creando && !correoValido(correo.trim())) {
      setError("Ese correo no parece válido. Revisa que esté completo.");
      return;
    }
    // Esta sí es exclusiva del frontend: al backend solo le llega una
    // contraseña, así que allá no hay nada que comparar.
    if (creando && password !== confirmacion) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setEnviando(true);
    try {
      if (creando) {
        await registrarUsuario(nombre.trim(), correo.trim(), password);
      } else {
        await iniciarSesion(nombre.trim(), password);
      }
      onListo();
    } catch (err) {
      // Los mensajes de Rust ya vienen redactados para el usuario final
      // ("Usuario o contraseña incorrectos.", "El usuario X ya existe.").
      console.error(err);
      setError(typeof err === "string" ? err : String(err));
      setEnviando(false);
    }
  }

  return (
    <div className={styles.pantalla}>
      <div className={styles.tarjeta}>
        <span className={styles.icono} aria-hidden="true">
          <IconCarrete />
        </span>

        <h1 className={styles.titulo}>
          {creando ? "Crear usuario" : "Iniciar sesión"}
        </h1>
        <p className={styles.subtitulo}>
          {creando
            ? "El usuario se guarda solo en esta computadora. Sirve para separar tus ventas y tu catálogo de los de otra persona."
            : "Puedes entrar con tu nombre de usuario o con tu correo, como prefieras."}
        </p>

        <form className={styles.formulario} onSubmit={enviar}>
          <div className="field">
            <label className="field-label" htmlFor="nombre-usuario">
              {creando ? "Nombre de usuario" : "Usuario o correo"}
            </label>
            <input
              id="nombre-usuario"
              className="input"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={creando ? undefined : "Usuario o correo"}
              autoComplete="username"
              autoFocus
              disabled={enviando}
            />
          </div>

          {creando && (
            <div className="field">
              <label className="field-label" htmlFor="correo">
                Correo
              </label>
              <input
                id="correo"
                className="input"
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                autoComplete="email"
                disabled={enviando}
              />
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={creando ? "new-password" : "current-password"}
              disabled={enviando}
            />
          </div>

          {creando && (
            <div className="field">
              <label className="field-label" htmlFor="confirmacion">
                Repite la contraseña
              </label>
              <input
                id="confirmacion"
                className="input"
                type="password"
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                autoComplete="new-password"
                disabled={enviando}
              />
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}

          {creando && (
            <p className={styles.aviso}>
              <strong>Anota tu contraseña en un lugar seguro.</strong> Se guarda
              cifrada y no hay forma de recuperarla si se te olvida.
            </p>
          )}

          <button
            type="submit"
            className={`btn btn-primary ${styles.botonPrincipal}`}
            disabled={enviando}
          >
            {enviando
              ? "Un momento..."
              : creando
                ? "Crear usuario y entrar"
                : "Entrar"}
          </button>
        </form>

        <div className={styles.alternativas}>
          <button
            type="button"
            className={styles.enlace}
            onClick={() => cambiarModo(creando ? "entrar" : "crear")}
            disabled={enviando}
          >
            {creando
              ? "Ya tengo un usuario"
              : "No tengo usuario, quiero crear uno"}
          </button>

          <button
            type="button"
            className={styles.enlace}
            onClick={onCancelar}
            disabled={enviando}
          >
            Seguir sin iniciar sesión
          </button>
        </div>

        <p className={styles.nota}>
          Iniciar sesión es opcional. Sin usuario, la app funciona igual y todo
          lo que registres se queda en esta computadora.
        </p>
      </div>
    </div>
  );
}

/* Misma piña de hilo que la barra lateral y la bienvenida. */
function IconCarrete() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5 17 19H7L12 2.5Z" />
      <path d="M9.4 11h5.2" />
      <path d="M8.6 14h6.8" />
      <ellipse cx="12" cy="19.5" rx="5" ry="1.8" />
    </svg>
  );
}
