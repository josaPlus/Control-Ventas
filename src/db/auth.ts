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
