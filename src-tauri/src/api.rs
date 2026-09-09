//! Cliente HTTP del backend (control-ventas-server, FastAPI).
//!
//! Aquí solo vive la AUTENTICACIÓN. La sincronización de datos (push/pull) es
//! un paso posterior y todavía no existe nada de eso.
//!
//! Regla de oro de este módulo: un fallo de red NUNCA es un error para el
//! usuario. Si el servidor no contesta, el login sigue su camino contra
//! SQLite y la app funciona igual que siempre. Por eso casi todo devuelve
//! `Option`/`ResultadoRemoto` en vez de propagar el error de reqwest.

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// A dónde apunta el cliente si nadie configura nada. El backend en local.
pub const API_URL_POR_DEFECTO: &str = "http://127.0.0.1:8000";

/// Variable de entorno que gana sobre cualquier otra configuración. Pensada
/// para desarrollo: `CONTROL_VENTAS_API_URL=http://otra-maquina:8000`.
pub const VAR_ENTORNO_API: &str = "CONTROL_VENTAS_API_URL";

/// Clave en la tabla `configuracion` (con usuario_id NULL, es un dato de la
/// instalación) para apuntar al servidor sin recompilar. Es la vía pensada
/// para el día que el backend deje de estar en localhost.
pub const CLAVE_API_URL: &str = "api_url";

/// Corto a propósito. Este timeout es lo que espera un vendedor sin conexión
/// antes de que el login caiga a modo local; si fuera de 30s parecería que la
/// app se colgó.
const TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Serialize)]
struct LoginPeticion<'a> {
    nombre_usuario: &'a str,
    password: &'a str,
}

#[derive(Deserialize)]
struct TokenRespuesta {
    access_token: String,
}

/// Respuesta de `GET /auth/me` y de `POST /usuarios`. Coincide con
/// `UsuarioRespuesta` del servidor.
#[derive(Deserialize, Debug, Clone)]
pub struct UsuarioRemoto {
    pub id_usuario: String,
    pub nombre_usuario: String,
    pub correo: String,
    pub rol: String,
}

/// Cómo terminó el alta de usuario contra el servidor.
#[derive(Debug)]
pub enum ResultadoRegistro {
    Creado(Box<UsuarioRemoto>),
    /// El servidor ya tiene ese nombre o correo. Trae el mensaje que redactó
    /// él, que distingue cuál de los dos campos chocó.
    YaExiste(String),
    /// Sin servidor a la vista: el alta sigue siendo local.
    NoDisponible,
}

#[derive(Serialize)]
struct RegistroPeticion<'a> {
    nombre_usuario: &'a str,
    correo: &'a str,
    password: &'a str,
}

#[derive(Deserialize)]
struct ErrorDetalle {
    detail: String,
}

/// Cómo terminó el intento de login contra el servidor.
#[derive(Debug)]
pub enum ResultadoRemoto {
    /// El servidor validó las credenciales.
    Autenticado {
        token: String,
        usuario: UsuarioRemoto,
    },
    /// El servidor contestó que las credenciales no sirven (401).
    ///
    /// Se distingue de `NoDisponible` a propósito, pero ojo: el login NO
    /// aborta por esto. Un vendedor puede tener cuenta local y no existir aún
    /// en el servidor, y ese caso tiene que seguir entrando (ver auth.rs).
    Rechazado,
    /// No hubo forma de hablar con el servidor: apagado, sin red, timeout,
    /// 500, o una respuesta que no se entiende. Todo esto es "sigue en local".
    NoDisponible,
}

/// URL base ya normalizada, o `None` si el login remoto está apagado.
///
/// Dejar la clave `api_url` vacía en `configuracion` es la forma de decir
/// "esta PC no habla con ningún servidor": el login ni siquiera intenta la
/// petición y entra directo a SQLite.
pub fn resolver_url(desde_configuracion: Option<String>) -> Option<String> {
    let crudo = match std::env::var(VAR_ENTORNO_API) {
        Ok(valor) => valor,
        Err(_) => desde_configuracion.unwrap_or_else(|| API_URL_POR_DEFECTO.to_string()),
    };

    let limpio = crudo.trim().trim_end_matches('/');
    if limpio.is_empty() {
        return None;
    }
    Some(limpio.to_string())
}

/// Traza lo que se va a mandar, SIN la contraseña.
///
/// Se imprime la longitud y si trae espacios en los bordes, que es lo único
/// que hace falta para descartar un dedazo o un autocompletado con espacio, y
/// nada de eso permite reconstruir la contraseña.
///
/// TEMPORAL: quitar cuando termine el diagnóstico del login remoto.
fn diagnostico_peticion(url: &str, identificador: &str, password: &str) {
    eprintln!("[DIAG login] POST {url}");
    eprintln!(
        "[DIAG login] body.nombre_usuario = «{identificador}» ({} chars){}",
        identificador.chars().count(),
        if identificador.contains('@') {
            "  <-- PARECE UN CORREO: el servidor solo acepta nombre_usuario"
        } else {
            ""
        }
    );
    eprintln!(
        "[DIAG login] body.password = {} chars{}{}",
        password.chars().count(),
        if password.is_empty() { "  <-- VACÍA" } else { "" },
        if password != password.trim() {
            "  <-- TIENE ESPACIOS AL INICIO O AL FINAL"
        } else {
            ""
        }
    );
}

fn cliente() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .connect_timeout(TIMEOUT)
        .build()
        .ok()
}

/// Intenta autenticar contra el backend.
///
/// El servidor compara SOLO contra `nombre_usuario` (ver routers/auth.py), así
/// que si el usuario escribió su correo en el campo de identificador, el
/// servidor va a responder 401. No es un problema: el flujo cae a local, que
/// sí sabe resolver correo, y la app entra igual.
pub async fn login(url_base: &str, identificador: &str, password: &str) -> ResultadoRemoto {
    let Some(cliente) = cliente() else {
        return ResultadoRemoto::NoDisponible;
    };

    let url = format!("{url_base}/auth/login");
    diagnostico_peticion(&url, identificador, password);

    let respuesta = cliente
        .post(&url)
        .json(&LoginPeticion {
            nombre_usuario: identificador,
            password,
        })
        .send()
        .await;

    let respuesta = match respuesta {
        Ok(r) => r,
        // Servidor apagado, DNS que no resuelve, timeout... todo es lo mismo
        // desde aquí: no hay servidor con quien hablar.
        Err(e) => {
            eprintln!("[DIAG login] no hubo respuesta del servidor: {e}");
            return ResultadoRemoto::NoDisponible;
        }
    };

    eprintln!("[DIAG login] el servidor respondió {}", respuesta.status());

    if respuesta.status() == reqwest::StatusCode::UNAUTHORIZED {
        // El cuerpo del 401 trae el 'detail' de FastAPI, que ayuda a separar
        // "credenciales invalidas" de cualquier otro rechazo.
        let detalle = respuesta.text().await.unwrap_or_default();
        eprintln!("[DIAG login] 401, cuerpo: {detalle}");
        return ResultadoRemoto::Rechazado;
    }
    if !respuesta.status().is_success() {
        // 500, 502, un proxy de por medio... El servidor está, pero no sirve.
        return ResultadoRemoto::NoDisponible;
    }

    let Ok(TokenRespuesta { access_token }) = respuesta.json::<TokenRespuesta>().await else {
        return ResultadoRemoto::NoDisponible;
    };

    // El token trae el id_usuario en 'sub', pero se pide /auth/me en vez de
    // decodificar el JWT aquí: la firma solo la puede validar el servidor, y
    // de paso /auth/me devuelve correo y rol, que hacen falta para crear la
    // fila local (correo es NOT NULL).
    match usuario_actual(&cliente, url_base, &access_token).await {
        Some(usuario) => ResultadoRemoto::Autenticado {
            token: access_token,
            usuario,
        },
        // Token sin perfil = no se puede anclar la sesión local. Se trata como
        // servidor no disponible y el login sigue en modo local.
        None => ResultadoRemoto::NoDisponible,
    }
}

/// Da de alta el usuario en el servidor (`POST /usuarios`, sin token: es el
/// único endpoint público).
///
/// Se llama ANTES de crear la fila local, para poder adoptar el `id_usuario`
/// que asigna el servidor. Así la cuenta nace con el mismo id en los dos
/// lados y la sincronización no tiene nada que reconciliar después.
pub async fn registrar(
    url_base: &str,
    nombre_usuario: &str,
    correo: &str,
    password: &str,
) -> ResultadoRegistro {
    let Some(cliente) = cliente() else {
        return ResultadoRegistro::NoDisponible;
    };

    let respuesta = cliente
        .post(format!("{url_base}/usuarios"))
        .json(&RegistroPeticion {
            nombre_usuario,
            correo,
            password,
        })
        .send()
        .await;

    let Ok(respuesta) = respuesta else {
        return ResultadoRegistro::NoDisponible;
    };

    if respuesta.status() == reqwest::StatusCode::CONFLICT {
        let mensaje = respuesta
            .json::<ErrorDetalle>()
            .await
            .map(|e| e.detail)
            .unwrap_or_else(|_| "Ese nombre de usuario o correo ya está registrado.".into());
        return ResultadoRegistro::YaExiste(mensaje);
    }
    if !respuesta.status().is_success() {
        return ResultadoRegistro::NoDisponible;
    }

    match respuesta.json::<UsuarioRemoto>().await {
        Ok(usuario) => ResultadoRegistro::Creado(Box::new(usuario)),
        Err(_) => ResultadoRegistro::NoDisponible,
    }
}

async fn usuario_actual(
    cliente: &reqwest::Client,
    url_base: &str,
    token: &str,
) -> Option<UsuarioRemoto> {
    // TEMPORAL (diagnóstico): bearer_auth arma exactamente
    // `Authorization: Bearer <token>`. Se imprime el prefijo del token, no el
    // token entero, para poder distinguir un JWT real (empieza en "eyJ") de
    // uno viejo o basura sin dejar credenciales en la consola.
    eprintln!(
        "[DIAG me] GET {url_base}/auth/me  header: 'Authorization: Bearer {}…' ({} chars)",
        &token.chars().take(6).collect::<String>(),
        token.chars().count()
    );

    let respuesta = cliente
        .get(format!("{url_base}/auth/me"))
        .bearer_auth(token)
        .send()
        .await
        .ok()?;

    eprintln!("[DIAG me] el servidor respondió {}", respuesta.status());

    if !respuesta.status().is_success() {
        return None;
    }
    respuesta.json::<UsuarioRemoto>().await.ok()
}

// ============================================
// DATOS (los usa sincronizacion.rs)
// ============================================
//
// Todo lo de aquí exige Bearer y el servidor acota por usuario_id solo, así
// que nunca se puede tocar lo de otra cuenta ni por error.

/// Error de una operación de datos. A diferencia del login, aquí sí hay que
/// distinguir: un fallo de red se reintenta después, un 4xx es un problema de
/// los datos que no se arregla reintentando.
#[derive(Debug)]
pub enum ErrorApi {
    /// Sin servidor: se reintenta en la próxima sincronización.
    SinConexion,
    /// El servidor contestó con un error. Trae su mensaje.
    Rechazado(String),
}

impl std::fmt::Display for ErrorApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErrorApi::SinConexion => write!(f, "sin conexión con el servidor"),
            ErrorApi::Rechazado(m) => write!(f, "{m}"),
        }
    }
}

async fn interpretar<T: serde::de::DeserializeOwned>(
    respuesta: Result<reqwest::Response, reqwest::Error>,
) -> Result<T, ErrorApi> {
    let respuesta = respuesta.map_err(|_| ErrorApi::SinConexion)?;

    if !respuesta.status().is_success() {
        let codigo = respuesta.status();
        let detalle = respuesta
            .json::<ErrorDetalle>()
            .await
            .map(|e| e.detail)
            .unwrap_or_else(|_| format!("el servidor respondió {codigo}"));
        return Err(ErrorApi::Rechazado(detalle));
    }

    respuesta
        .json::<T>()
        .await
        .map_err(|e| ErrorApi::Rechazado(format!("respuesta ilegible del servidor: {e}")))
}

/// Cliente autenticado. Se construye una vez por sincronización en vez de por
/// petición, para reutilizar la conexión TCP en toda la tanda.
pub struct ApiAutenticada {
    cliente: reqwest::Client,
    url_base: String,
    token: String,
}

impl ApiAutenticada {
    pub fn nueva(url_base: &str, token: &str) -> Option<Self> {
        Some(Self {
            cliente: cliente()?,
            url_base: url_base.to_string(),
            token: token.to_string(),
        })
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, ruta: &str) -> Result<T, ErrorApi> {
        let envio = self
            .cliente
            .get(format!("{}{ruta}", self.url_base))
            .bearer_auth(&self.token)
            .send()
            .await;
        interpretar(envio).await
    }

    async fn post<T: serde::de::DeserializeOwned>(
        &self,
        ruta: &str,
        cuerpo: &serde_json::Value,
    ) -> Result<T, ErrorApi> {
        let envio = self
            .cliente
            .post(format!("{}{ruta}", self.url_base))
            .bearer_auth(&self.token)
            .json(cuerpo)
            .send()
            .await;
        interpretar(envio).await
    }

    async fn put<T: serde::de::DeserializeOwned>(
        &self,
        ruta: &str,
        cuerpo: &serde_json::Value,
    ) -> Result<T, ErrorApi> {
        let envio = self
            .cliente
            .put(format!("{}{ruta}", self.url_base))
            .bearer_auth(&self.token)
            .json(cuerpo)
            .send()
            .await;
        interpretar(envio).await
    }

    // ---- catálogos ----
    //
    // No tienen uuid: su identidad en el servidor es (usuario_id, nombre), y
    // un POST repetido devuelve 409. Por eso se listan primero y solo se
    // manda lo que falta.

    pub async fn listar_catalogo(&self, tabla: &str) -> Result<Vec<FilaCatalogo>, ErrorApi> {
        self.get(&format!("/{tabla}")).await
    }

    pub async fn crear_catalogo(
        &self,
        tabla: &str,
        nombre: &str,
    ) -> Result<FilaCatalogo, ErrorApi> {
        self.post(
            &format!("/{tabla}"),
            &serde_json::json!({ "nombre": nombre, "sync_estado": "sincronizado" }),
        )
        .await
    }

    // ---- clientes ----

    pub async fn listar_clientes(&self) -> Result<Vec<FilaCliente>, ErrorApi> {
        self.get("/clientes").await
    }

    pub async fn crear_cliente(&self, cuerpo: &serde_json::Value) -> Result<FilaCliente, ErrorApi> {
        self.post("/clientes", cuerpo).await
    }

    pub async fn actualizar_cliente(
        &self,
        id: i64,
        cuerpo: &serde_json::Value,
    ) -> Result<FilaCliente, ErrorApi> {
        self.put(&format!("/clientes/{id}"), cuerpo).await
    }

    // ---- notas de venta ----

    pub async fn listar_notas(&self) -> Result<Vec<FilaNota>, ErrorApi> {
        self.get("/notas-venta").await
    }

    pub async fn crear_nota(&self, cuerpo: &serde_json::Value) -> Result<FilaNota, ErrorApi> {
        self.post("/notas-venta", cuerpo).await
    }

    pub async fn actualizar_nota(
        &self,
        id: i64,
        cuerpo: &serde_json::Value,
    ) -> Result<FilaNota, ErrorApi> {
        self.put(&format!("/notas-venta/{id}"), cuerpo).await
    }
}

/// Solo los campos que la sincronización necesita de vuelta; el resto de la
/// respuesta se ignora.
#[derive(Deserialize, Debug)]
pub struct FilaCatalogo {
    pub nombre: String,
}

#[derive(Deserialize, Debug)]
pub struct FilaCliente {
    pub id: i64,
    pub uuid_cliente: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct FilaNota {
    pub id: i64,
    pub uuid_nota_venta: Option<String>,
}

/// Si el token que teníamos guardado sigue sirviendo. Se usa al arrancar para
/// saber si la sesión está respaldada por el servidor o solo por SQLite.
///
/// Un `false` aquí no cierra la sesión: puede ser simplemente que la PC esté
/// sin internet, y echar al usuario por eso sería justo lo contrario de lo que
/// se busca.
pub async fn token_sigue_vigente(url_base: &str, token: &str) -> bool {
    let Some(cliente) = cliente() else {
        return false;
    };
    usuario_actual(&cliente, url_base, token).await.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    // La variable de entorno se comparte entre tests del mismo binario, así
    // que estos casos van juntos en un solo test en vez de en varios que
    // podrían pisarse al correr en paralelo.
    #[test]
    fn resolucion_de_la_url() {
        std::env::remove_var(VAR_ENTORNO_API);

        // Sin nada configurado, el backend local.
        assert_eq!(resolver_url(None).as_deref(), Some(API_URL_POR_DEFECTO));

        // La configuración manda sobre el default.
        assert_eq!(
            resolver_url(Some("http://192.168.1.50:8000".into())).as_deref(),
            Some("http://192.168.1.50:8000")
        );

        // La diagonal final se recorta para no formar '...//auth/login'.
        assert_eq!(
            resolver_url(Some("https://api.ejemplo.com/".into())).as_deref(),
            Some("https://api.ejemplo.com")
        );

        // Cadena vacía = login remoto apagado en esta PC.
        assert_eq!(resolver_url(Some("".into())), None);
        assert_eq!(resolver_url(Some("   ".into())), None);

        // La variable de entorno gana sobre la configuración.
        std::env::set_var(VAR_ENTORNO_API, "http://otra-maquina:9000");
        assert_eq!(
            resolver_url(Some("http://192.168.1.50:8000".into())).as_deref(),
            Some("http://otra-maquina:9000")
        );
        std::env::remove_var(VAR_ENTORNO_API);
    }

    // Un puerto donde con toda seguridad no hay nada escuchando: el caso del
    // vendedor sin conexión. Tiene que resolverse rápido y sin pánico.
    #[tokio::test]
    async fn sin_servidor_responde_no_disponible() {
        let resultado = login("http://127.0.0.1:1", "Josafat", "hilo1234").await;
        assert!(matches!(resultado, ResultadoRemoto::NoDisponible));
    }

    #[tokio::test]
    async fn una_url_que_no_resuelve_tampoco_truena() {
        let resultado = login("http://no-existe.invalid", "Josafat", "hilo1234").await;
        assert!(matches!(resultado, ResultadoRemoto::NoDisponible));
    }

    // ---- Contra un backend de verdad escuchando en 127.0.0.1:8000 ----
    //
    // Marcados #[ignore] porque necesitan el servidor levantado. Correr con:
    //   cargo test -- --ignored
    // sirven igual contra el FastAPI real que contra scratchpad/stub_backend.py

    #[tokio::test]
    #[ignore = "necesita el backend en 127.0.0.1:8000"]
    async fn login_correcto_devuelve_token_y_perfil() {
        let resultado = login(API_URL_POR_DEFECTO, "Josafat", "hilo1234").await;
        match resultado {
            ResultadoRemoto::Autenticado { token, usuario } => {
                assert!(!token.is_empty());
                assert_eq!(usuario.nombre_usuario, "Josafat");
                assert!(usuario.correo.contains('@'));
            }
            otro => panic!("se esperaba Autenticado, llegó {otro:?}"),
        }
    }

    #[tokio::test]
    #[ignore = "necesita el backend en 127.0.0.1:8000"]
    async fn password_incorrecta_es_rechazado_no_no_disponible() {
        let resultado = login(API_URL_POR_DEFECTO, "Josafat", "password-mala").await;
        assert!(matches!(resultado, ResultadoRemoto::Rechazado));
    }

    // El endpoint del servidor solo compara nombre_usuario. Que responda 401
    // ante un correo es el comportamiento correcto, y el que hace que el
    // fallback a local sea imprescindible para no romper el login por correo.
    #[tokio::test]
    #[ignore = "necesita el backend en 127.0.0.1:8000"]
    async fn el_servidor_no_acepta_el_correo_como_identificador() {
        let resultado = login(API_URL_POR_DEFECTO, "josafat@correo.com", "hilo1234").await;
        assert!(matches!(resultado, ResultadoRemoto::Rechazado));
    }

    #[tokio::test]
    #[ignore = "necesita el backend en 127.0.0.1:8000"]
    async fn un_token_inventado_no_pasa_la_revalidacion() {
        assert!(!token_sigue_vigente(API_URL_POR_DEFECTO, "no-soy-un-token").await);
    }
}
