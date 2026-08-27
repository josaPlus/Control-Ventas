import { invoke } from '@tauri-apps/api/core';

// Espejo del struct Usuario de src-tauri/src/auth.rs. El hash de la contraseña
// no viaja hasta acá a propósito: no tiene por qué existir en JavaScript.
export interface Usuario {
  id_usuario: string;
  nombre_usuario: string;
  correo: string;
  rol: string;
  ultima_sincronizacion: string | null;
}

// Todo el login es local: se valida contra la tabla `usuarios` de SQLite con
// Argon2. No hay servidor todavía, así que ninguna de estas funciones toca la
// red ni puede fallar por falta de conexión.

export async function registrarUsuario(
  nombreUsuario: string,
  correo: string,
  password: string
): Promise<Usuario> {
  return await invoke<Usuario>('registrar_usuario', {
    nombreUsuario,
    correo,
    password,
  });
}

// `identificador` es el nombre de usuario O el correo, indistintamente: a nadie
// le toca recordar con cuál de los dos se dio de alta.
export async function iniciarSesion(
  identificador: string,
  password: string
): Promise<Usuario> {
  return await invoke<Usuario>('iniciar_sesion', { identificador, password });
}

export async function cerrarSesion(): Promise<void> {
  await invoke('cerrar_sesion');
}

// Devuelve null si se está usando la app sin sesión, que es un modo válido y
// permanente, no un error. Al arrancar, Rust recupera la sesión recordada
// desde `configuracion`, así que esto ya responde con el usuario correcto sin
// tener que volver a pedir contraseña.
export async function usuarioActual(): Promise<Usuario | null> {
  return await invoke<Usuario | null>('usuario_actual');
}

// ============================================
// CONEXIÓN CON EL SERVIDOR
// ============================================

// Cómo está respaldada la sesión actual.
//
// Ojo con lo que NO está aquí: el JWT. El token vive en Rust y en el llavero
// del sistema operativo, y no cruza a JavaScript en ninguna forma. Si alguna
// vez hace falta llamar al backend, la llamada se hace desde Rust, que es
// quien tiene el token.
export interface EstadoConexion {
  /** 'remoto' si se validó contra el backend, 'local' si solo contra SQLite. */
  modo: 'remoto' | 'local';
  token_en_memoria: boolean;
  /** A qué backend apunta esta instalación, o null si el remoto está apagado. */
  api_url: string | null;
}

export async function estadoConexion(): Promise<EstadoConexion> {
  return await invoke<EstadoConexion>('estado_conexion');
}

// ============================================
// SINCRONIZACIÓN (solo subida)
// ============================================

export interface PendientesSync {
  clientes: number;
  notas_venta: number;
  colores_hilo: number;
  tipos_hilo: number;
}

export interface ResumenSync {
  clientes: number;
  notas_venta: number;
  colores_hilo: number;
  tipos_hilo: number;
  /** Lo que el servidor rechazó fila por fila. Que venga con algo no
   *  significa que la sincronización fallara: el resto sí subió. */
  problemas: string[];
}

export async function contarPendientesSync(): Promise<PendientesSync> {
  return await invoke<PendientesSync>('contar_pendientes_sync');
}

// Sube lo pendiente. Lanza si no hay sesión con servidor o si se cae la
// conexión a media tanda; lo que alcanzó a subir queda marcado.
export async function sincronizarAhora(): Promise<ResumenSync> {
  return await invoke<ResumenSync>('sincronizar_ahora');
}

export function totalPendiente(p: PendientesSync): number {
  return p.clientes + p.notas_venta + p.colores_hilo + p.tipos_hilo;
}

// ============================================
// ADOPCIÓN DE DATOS LOCALES
// ============================================

// Lo que quedó sin dueño: capturado antes de que existiera el login, o
// mientras se trabajó sin iniciar sesión.
export interface ConteoLocal {
  clientes: number;
  notas_venta: number;
  colores_hilo: number;
  tipos_hilo: number;
  configuracion: number;
}

export interface ResumenAdopcion {
  clientes: number;
  notas_venta: number;
  colores_hilo: number;
  colores_hilo_descartados: number;
  tipos_hilo: number;
  tipos_hilo_descartados: number;
  configuracion: number;
  configuracion_descartada: number;
}

export async function contarDatosLocales(): Promise<ConteoLocal> {
  return await invoke<ConteoLocal>('contar_datos_locales');
}

// Asocia a la cuenta activa todo lo que esté sin dueño. Es una acción
// explícita del usuario: nunca se dispara sola al iniciar sesión, porque en
// una PC compartida el primer login se apropiaría de las ventas de otro.
export async function adoptarDatosLocales(): Promise<ResumenAdopcion> {
  return await invoke<ResumenAdopcion>('adoptar_datos_locales');
}
