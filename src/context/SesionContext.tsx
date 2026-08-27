import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  cerrarSesion as cerrarSesionCmd,
  estadoConexion,
  iniciarSesion as iniciarSesionCmd,
  registrarUsuario as registrarUsuarioCmd,
  usuarioActual,
  type EstadoConexion,
  type Usuario,
} from "../db/auth";

interface SesionValue {
  /** Quién tiene la sesión abierta, o null si se usa sin login. */
  usuario: Usuario | null;
  /** Mientras se recupera la sesión recordada al arrancar. */
  cargando: boolean;
  /**
   * Si la sesión está respaldada por el backend o solo por SQLite. `null`
   * mientras no se sabe. Es informativo: en modo 'local' la app funciona
   * completa, no es un estado degradado que haya que resolver.
   */
  conexion: EstadoConexion | null;
  /**
   * Cambia cada vez que el conjunto de datos visible deja de ser el mismo:
   * al entrar, al salir, y al adoptar datos locales.
   *
   * Existe por el caso de la adopción, que mueve filas de alcance sin cambiar
   * de usuario — mirar solo `usuario` no bastaría para saber que hay que
   * recargar. Los componentes que leen datos acotados por sesión lo ponen en
   * su array de dependencias.
   */
  revisionDatos: number;
  /** Para avisar que los datos cambiaron de alcance (adopción). */
  refrescarDatos: () => void;
  /** `identificador` es el nombre de usuario o el correo, indistintamente. */
  iniciarSesion: (identificador: string, password: string) => Promise<void>;
  registrarUsuario: (
    nombre: string,
    correo: string,
    password: string
  ) => Promise<void>;
  cerrarSesion: () => Promise<void>;
}

const SesionContext = createContext<SesionValue | null>(null);

export function useSesion(): SesionValue {
  const valor = useContext(SesionContext);
  if (!valor) {
    throw new Error("useSesion debe usarse dentro de <SesionProvider>");
  }
  return valor;
}

/**
 * Estado de la sesión para toda la app.
 *
 * A diferencia de <ConfiguracionProvider>, este NO hace de puerta: iniciar
 * sesión es opcional y lo va a seguir siendo. Una PC que nunca haga login
 * funciona igual que antes de que existiera esta pantalla, con sus datos en
 * modo local. Bloquear aquí obligaría a las instalaciones que ya están
 * trabajando a inventarse un usuario para poder seguir vendiendo.
 *
 * Tampoco tumba la app si `usuario_actual` falla: sin sesión se sigue
 * operando, así que un error al consultarla se registra y se sigue en local.
 */
export function SesionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [conexion, setConexion] = useState<EstadoConexion | null>(null);
  const [revisionDatos, setRevisionDatos] = useState(0);

  const refrescarDatos = () => setRevisionDatos((n) => n + 1);

  // Si falla, se deja en null y la interfaz simplemente no muestra la
  // etiqueta. No hay nada que el usuario pueda hacer al respecto.
  const refrescarConexion = () =>
    estadoConexion()
      .then(setConexion)
      .catch((err) => console.error("No se pudo leer el estado de conexión:", err));

  useEffect(() => {
    // Rust busca en memoria y, si está vacía (app recién abierta), baja a la
    // tabla `configuracion`. Por eso al reabrir no se vuelve a pedir nada.
    usuarioActual()
      .then(setUsuario)
      .catch((err) => console.error("No se pudo recuperar la sesión:", err))
      .finally(() => setCargando(false));

    // Al arrancar, Rust valida el token guardado contra el servidor en una
    // tarea aparte. Se consulta con un respiro para alcanzar a ver el
    // resultado de esa validación y no el estado previo.
    refrescarConexion();
    const id = setTimeout(refrescarConexion, 5000);
    return () => clearTimeout(id);
  }, []);

  // Los errores se dejan propagar: el formulario es quien sabe cómo
  // mostrarlos ("Usuario o contraseña incorrectos" va junto al campo, no en
  // un banner global).
  async function iniciarSesion(identificador: string, password: string) {
    setUsuario(await iniciarSesionCmd(identificador, password));
    await refrescarConexion();
    refrescarDatos();
  }

  // Crear la cuenta deja la sesión iniciada: pedirle la contraseña otra vez
  // justo después de escribirla dos veces no aporta nada.
  async function registrarUsuario(nombre: string, correo: string, password: string) {
    await registrarUsuarioCmd(nombre, correo, password);
    setUsuario(await iniciarSesionCmd(nombre, password));
    await refrescarConexion();
    refrescarDatos();
  }

  async function cerrarSesion() {
    await cerrarSesionCmd();
    setUsuario(null);
    await refrescarConexion();
    refrescarDatos();
  }

  return (
    <SesionContext.Provider
      value={{
        usuario,
        cargando,
        conexion,
        revisionDatos,
        refrescarDatos,
        iniciarSesion,
        registrarUsuario,
        cerrarSesion,
      }}
    >
      {children}
    </SesionContext.Provider>
  );
}
