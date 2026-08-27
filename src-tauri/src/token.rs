//! Dónde vive el JWT.
//!
//! Dos capas, y ninguna es el WebView:
//!
//! 1. **En memoria** (`EstadoToken`), para la corrida actual. El token nunca
//!    cruza el puente hacia JavaScript — ningún comando lo devuelve. Si el
//!    frontend nunca lo ve, no lo puede filtrar en un log, en un `console.log`
//!    ni en el DOM.
//! 2. **En el almacén de credenciales del sistema operativo** (Credential
//!    Manager en Windows, Llavero en macOS, Secret Service en Linux), para que
//!    sobreviva al reinicio.
//!
//! Lo que NO se hace y por qué:
//! - `localStorage`/`sessionStorage`: cualquier script en el WebView los lee.
//! - La tabla `configuracion`: el .db es un archivo plano que se copia, se
//!   respalda y se manda por correo. Un JWT ahí es un JWT publicado.
//!
//! En `configuracion` solo queda un rastro NO secreto (`sesion_modo`), que
//! dice si la sesión se validó contra el servidor o solo contra SQLite.

use std::sync::Mutex;

/// Token de la corrida actual. `None` = sesión sin respaldo del servidor
/// (login local, o servidor no disponible al entrar).
///
/// Tipo propio y no un alias, por la misma razón que `EstadoSesion`: Tauri
/// indexa el state por TypeId y los dos guardan `Mutex<Option<String>>`. Como
/// alias serían el mismo tipo y `.manage()` fallaría al arrancar.
pub struct EstadoToken(Mutex<Option<String>>);

impl EstadoToken {
    pub fn nuevo() -> Self {
        Self(Mutex::new(None))
    }
}

impl std::ops::Deref for EstadoToken {
    type Target = Mutex<Option<String>>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

const SERVICIO: &str = "control-ventas";

/// Una entrada por usuario: si dos vendedores comparten la PC, cada quien
/// conserva su token y cerrar sesión uno no borra el del otro.
fn entrada(id_usuario: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICIO, id_usuario).ok()
}

/// Guarda el token. Un fallo del llavero NO es fatal: la sesión sigue viva en
/// memoria durante esta corrida y lo único que se pierde es que al reabrir la
/// app haya que volver a autenticarse contra el servidor. Preferimos eso a
/// negarle el login a alguien porque el Credential Manager anda raro.
pub fn guardar(id_usuario: &str, token: &str) {
    if let Some(entrada) = entrada(id_usuario) {
        if let Err(e) = entrada.set_password(token) {
            eprintln!("Aviso: no se pudo guardar el token en el llavero: {e}");
        }
    }
}

pub fn leer(id_usuario: &str) -> Option<String> {
    entrada(id_usuario)?.get_password().ok()
}

/// Borra el token del llavero. Que no exista no es un error: cerrar sesión
/// desde una sesión que nunca tuvo token es perfectamente normal.
pub fn borrar(id_usuario: &str) {
    if let Some(entrada) = entrada(id_usuario) {
        match entrada.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => eprintln!("Aviso: no se pudo borrar el token del llavero: {e}"),
        }
    }
}
