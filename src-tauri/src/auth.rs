//! Login local.
//!
//! Hoy NO hay servidor: la tabla `usuarios` de SQLite es la fuente de verdad,
//! no un cache. Todo lo de aquí trabaja contra el archivo local y nada más.
//!
//! Está escrito para que conectar el servidor después no obligue a reescribir:
//! los comandos que consume el frontend (`registrar_usuario`, `iniciar_sesion`,
//! `cerrar_sesion`, `usuario_actual`) ya tienen la firma definitiva. Lo único
//! que cambiará por dentro es que `iniciar_sesion` intente primero contra la
//! API y caiga al hash local si no hay red, y que `registrar_usuario` deje de
//! inventar el UUID cuando el servidor sea quien lo asigne.

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use crate::db::obtener_pool;

/// Sesión en memoria. `None` = nadie ha iniciado sesión en esta corrida.
///
/// Es `Option<Option<String>>` por dentro? No: un solo `Option`. El caso "ya
/// miré en la base y no había nada" no se distingue de "no he mirado", y está
/// bien — releer una fila de `configuracion` es barato y pasa una vez.
pub type EstadoSesion = Mutex<Option<String>>;

/// Dónde se recuerda la sesión entre reinicios. Va con `usuario_id = NULL`
/// porque es metadato de la instalación ("quién dejó la sesión abierta en esta
/// PC"), no una preferencia de un usuario en particular. Guardarla bajo el
/// usuario sería circular: haría falta saber quién es para poder leer quién es.
pub const CLAVE_SESION: &str = "sesion_usuario_id";

/// Lo que ve el frontend. `password_hash` NO está aquí a propósito: no tiene
/// por qué cruzar el puente hacia JavaScript ni aparecer en un log.
// Debug NO incluye password_hash porque el campo no existe en el struct: aun
// si alguien loguea un Usuario entero, no hay contraseña que filtrar.
#[derive(Serialize, Clone, Debug, sqlx::FromRow)]
pub struct Usuario {
    pub id_usuario: String,
    pub nombre_usuario: String,
    pub correo: String,
    pub rol: String,
    pub ultima_sincronizacion: Option<String>,
}

const COLUMNAS_USUARIO: &str =
    "id_usuario, nombre_usuario, correo, rol, ultima_sincronizacion";

/// Espacios fuera y nada de distinguir por mayúsculas. La columna ya es
/// COLLATE NOCASE, así que "Josafat" y "josafat" son el mismo usuario para el
/// UNIQUE; esto solo evita que se guarde con espacios pegados.
fn normalizar_nombre_usuario(valor: &str) -> String {
    valor.trim().to_string()
}

/// Validación deliberadamente laxa: que haya algo antes de una @, algo después,
/// y un punto con algo a cada lado en el dominio.
///
/// No se intenta validar de verdad un correo — la gramática real (RFC 5322)
/// acepta cosas que nadie escribe y la única comprobación que sirve es mandar
/// un mensaje. Esto solo ataja el dedazo evidente ("josafat", "josafat@").
fn correo_valido(correo: &str) -> bool {
    let Some((local, dominio)) = correo.split_once('@') else {
        return false;
    };
    if local.is_empty() || dominio.starts_with('.') || dominio.ends_with('.') {
        return false;
    }
    // Un solo '@' en toda la cadena, y el dominio con al menos un punto
    // interior rodeado de texto.
    !dominio.contains('@')
        && dominio
            .split_once('.')
            .is_some_and(|(antes, despues)| !antes.is_empty() && !despues.is_empty())
}

fn hashear(password: &str) -> Result<String, String> {
    let sal = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &sal)
        .map(|h| h.to_string())
        .map_err(|e| format!("No se pudo procesar la contraseña: {e}"))
}

fn verificar(password: &str, hash_guardado: &str) -> bool {
    // Un hash corrupto en la base se trata como contraseña inválida, no como
    // error a mostrar: al usuario le sirve igual "credenciales incorrectas" y
    // no revelamos el estado interno.
    match PasswordHash::new(hash_guardado) {
        Ok(parseado) => Argon2::default()
            .verify_password(password.as_bytes(), &parseado)
            .is_ok(),
        Err(_) => false,
    }
}

async fn buscar_por_id(
    pool: &sqlx::SqlitePool,
    id_usuario: &str,
) -> Result<Option<Usuario>, String> {
    sqlx::query_as::<_, Usuario>(&format!(
        "SELECT {COLUMNAS_USUARIO} FROM usuarios WHERE id_usuario = ?1"
    ))
    .bind(id_usuario)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Escribe (o borra) la fila que recuerda la sesión entre reinicios.
async fn recordar_sesion(
    pool: &sqlx::SqlitePool,
    id_usuario: Option<&str>,
) -> Result<(), String> {
    match id_usuario {
        Some(id) => {
            // El ON CONFLICT apunta al índice parcial de la v4
            // (idx_configuracion_sin_usuario), que es el que de verdad hace
            // cumplir la unicidad cuando usuario_id es NULL.
            sqlx::query(
                "INSERT INTO configuracion (usuario_id, clave, valor)
                 VALUES (NULL, ?1, ?2)
                 ON CONFLICT(clave) WHERE usuario_id IS NULL
                 DO UPDATE SET valor = excluded.valor",
            )
            .bind(CLAVE_SESION)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
        None => {
            sqlx::query(
                "DELETE FROM configuracion WHERE clave = ?1 AND usuario_id IS NULL",
            )
            .bind(CLAVE_SESION)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

async fn leer_sesion_recordada(pool: &sqlx::SqlitePool) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT valor FROM configuracion WHERE clave = ?1 AND usuario_id IS NULL",
    )
    .bind(CLAVE_SESION)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Quién está operando la app ahora mismo, o `None` si se está usando sin
/// login. Es la función que consultan ventas, clientes y catálogos para saber
/// qué poner en `usuario_id`.
///
/// Mira primero la memoria; si está vacía (la app acaba de arrancar) baja a
/// `configuracion` y deja el valor cacheado.
pub async fn usuario_id_de_sesion(
    pool: &sqlx::SqlitePool,
    estado: &EstadoSesion,
) -> Result<Option<String>, String> {
    // El guard se suelta antes del await de abajo: es un Mutex de std y
    // mantenerlo cruzando un punto de espera es justo cómo se traba todo.
    if let Some(id) = estado.lock().map_err(|_| "Sesión corrupta.")?.clone() {
        return Ok(Some(id));
    }

    let recordado = leer_sesion_recordada(pool).await?;

    // Si el usuario recordado ya no existe (base restaurada, usuario borrado
    // a mano), la referencia se descarta en vez de arrastrar un id fantasma
    // hacia las filas nuevas.
    let Some(id) = recordado else {
        return Ok(None);
    };
    if buscar_por_id(pool, &id).await?.is_none() {
        recordar_sesion(pool, None).await?;
        return Ok(None);
    }

    *estado.lock().map_err(|_| "Sesión corrupta.")? = Some(id.clone());
    Ok(Some(id))
}

/// `sync_estado` que le toca a una fila recién creada según haya sesión o no.
///
/// Sin login la fila es 'local' y no se va a sincronizar nunca; con login nace
/// 'pendiente', esperando al servidor que todavía no existe. Se escribe
/// explícito en cada INSERT aunque el DEFAULT de la tabla diga lo mismo: el
/// día que el default cambie, las escrituras no cambian de significado solas.
pub fn sync_estado_inicial(usuario_id: Option<&str>) -> &'static str {
    match usuario_id {
        Some(_) => "pendiente",
        None => "local",
    }
}

/// Alta de usuario. Hoy es puramente local; cuando exista el servidor, este es
/// el punto donde se registrará contra la API y el `id_usuario` vendrá de allá
/// en vez de generarse aquí.
#[tauri::command]
pub async fn registrar_usuario(
    db_instances: State<'_, DbInstances>,
    nombre_usuario: String,
    correo: String,
    password: String,
) -> Result<Usuario, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    registrar_usuario_en(&pool, &nombre_usuario, &correo, &password).await
}

/// El cuerpo real, separado del comando para poder probarlo: un
/// `#[tauri::command]` necesita un `State` que solo existe con la app
/// corriendo, y estas validaciones son justo lo que hay que cubrir.
async fn registrar_usuario_en(
    pool: &sqlx::SqlitePool,
    nombre_usuario: &str,
    correo: &str,
    password: &str,
) -> Result<Usuario, String> {
    let nombre = normalizar_nombre_usuario(nombre_usuario);
    let correo = normalizar_nombre_usuario(correo);

    if nombre.is_empty() {
        return Err("El nombre de usuario no puede estar vacío.".into());
    }
    if correo.is_empty() {
        return Err("El correo no puede estar vacío.".into());
    }
    if !correo_valido(&correo) {
        return Err("Ese correo no parece válido. Revisa que esté completo.".into());
    }
    if password.len() < 4 {
        return Err("La contraseña debe tener al menos 4 caracteres.".into());
    }

    // Dos consultas separadas porque sqlx no dice QUÉ restricción UNIQUE se
    // violó, y el mensaje tiene que ser distinto para cada campo. El UNIQUE de
    // la tabla sigue siendo lo que cierra la carrera entre dos altas
    // simultáneas; esto es solo para poder redactar el error.
    let correo_tomado: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usuarios WHERE correo = ?1")
        .bind(&correo)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let nombre_tomado: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM usuarios WHERE nombre_usuario = ?1")
            .bind(&nombre)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;

    // El correo tiene prioridad si chocan los dos: es el dato con el que la
    // persona reconoce más fácil que ya tiene cuenta.
    if correo_tomado > 0 {
        return Err("Ese correo ya está registrado.".into());
    }
    if nombre_tomado > 0 {
        return Err("Ese nombre de usuario ya está en uso.".into());
    }

    let id_usuario = Uuid::new_v4().to_string();
    let hash = hashear(password)?;

    sqlx::query(
        "INSERT INTO usuarios (id_usuario, nombre_usuario, correo, password_hash, rol)
         VALUES (?1, ?2, ?3, ?4, 'vendedor')",
    )
    .bind(&id_usuario)
    .bind(&nombre)
    .bind(&correo)
    .bind(&hash)
    .execute(pool)
    .await
    .map_err(|e| {
        // Red de seguridad por si dos altas entran a la vez y una pierde la
        // carrera contra el UNIQUE. Aquí sí toca un mensaje genérico: el error
        // de sqlx no dice qué columna fue.
        if e.to_string().contains("UNIQUE") {
            "Ese nombre de usuario o correo ya está registrado.".to_string()
        } else {
            e.to_string()
        }
    })?;

    buscar_por_id(pool, &id_usuario)
        .await?
        .ok_or_else(|| "El usuario se creó pero no se pudo leer de vuelta.".to_string())
}

/// Valida contra el hash local y deja la sesión abierta, en memoria y
/// recordada en disco.
///
/// `identificador` es el nombre de usuario O el correo, indistintamente: a
/// nadie le toca recordar con cuál de los dos se dio de alta. Las dos columnas
/// son COLLATE NOCASE en el esquema, así que la comparación ya ignora
/// mayúsculas sin repetirlo en la consulta.
#[tauri::command]
pub async fn iniciar_sesion(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    identificador: String,
    password: String,
) -> Result<Usuario, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    iniciar_sesion_en(&pool, estado.inner(), &identificador, &password).await
}

/// El cuerpo real, separado del comando para poder probarlo. Ver la nota en
/// `registrar_usuario_en`.
async fn iniciar_sesion_en(
    pool: &sqlx::SqlitePool,
    estado: &EstadoSesion,
    identificador: &str,
    password: &str,
) -> Result<Usuario, String> {
    let identificador = normalizar_nombre_usuario(identificador);
    if identificador.is_empty() {
        return Err("Ingresa tu usuario o correo.".into());
    }

    let fila: Option<(String, String)> = sqlx::query_as(
        "SELECT id_usuario, password_hash FROM usuarios
          WHERE nombre_usuario = ?1 OR correo = ?1",
    )
    .bind(&identificador)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Mismo mensaje si el identificador no existe y si la contraseña está mal.
    // Distinguirlos convertiría el login en una forma de averiguar qué correos
    // están registrados.
    let Some((id_usuario, hash)) = fila else {
        return Err("Usuario o contraseña incorrectos.".into());
    };
    if !verificar(password, &hash) {
        return Err("Usuario o contraseña incorrectos.".into());
    }

    recordar_sesion(pool, Some(&id_usuario)).await?;
    *estado.lock().map_err(|_| "Sesión corrupta.")? = Some(id_usuario.clone());

    buscar_por_id(pool, &id_usuario)
        .await?
        .ok_or_else(|| "El usuario desapareció durante el inicio de sesión.".to_string())
}

/// Cierra sesión: memoria y disco. Lo ya capturado con ese usuario conserva su
/// `usuario_id` — cerrar sesión no reescribe historial.
#[tauri::command]
pub async fn cerrar_sesion(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
) -> Result<(), String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    recordar_sesion(&pool, None).await?;
    *estado.lock().map_err(|_| "Sesión corrupta.")? = None;
    Ok(())
}

/// Quién tiene la sesión abierta, incluyendo el caso de app recién arrancada
/// donde la memoria está vacía y hay que recuperarlo de `configuracion`.
#[tauri::command]
pub async fn usuario_actual(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
) -> Result<Option<Usuario>, String> {
    let pool = obtener_pool(db_instances.inner()).await?;

    let Some(id) = usuario_id_de_sesion(&pool, estado.inner()).await? else {
        return Ok(None);
    };
    buscar_por_id(&pool, &id).await
}

// ============================================
// ADOPCIÓN DE DATOS LOCALES
// ============================================
//
// Lo capturado antes de que existiera el login (o mientras se trabajó sin
// iniciar sesión) queda con usuario_id NULL. Adoptarlo es asociarlo a la
// cuenta actual.
//
// Es SIEMPRE una acción explícita del usuario, nunca un efecto secundario de
// iniciar sesión: en una PC compartida, que el primer login se apropie de las
// ventas de otro sería justo lo contrario de lo que se busca.

#[derive(serde::Serialize)]
pub struct ConteoLocal {
    pub clientes: i64,
    pub notas_venta: i64,
    pub colores_hilo: i64,
    pub tipos_hilo: i64,
    pub configuracion: i64,
}

/// Cuánto hay sin dueño. Solo lectura: alimenta el aviso de Ajustes.
#[tauri::command]
pub async fn contar_datos_locales(
    db_instances: State<'_, DbInstances>,
) -> Result<ConteoLocal, String> {
    let pool = obtener_pool(db_instances.inner()).await?;

    async fn contar(pool: &sqlx::SqlitePool, tabla: &str) -> Result<i64, String> {
        sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {tabla} WHERE usuario_id IS NULL"
        ))
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
    }

    // La sesión recordada no se cuenta ni se adopta (ver adoptar_datos_locales),
    // así que tampoco debe aparecer en el aviso: si fuera lo único que queda,
    // el usuario vería "1 ajuste por adoptar" que nunca baja a cero.
    let configuracion: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM configuracion WHERE usuario_id IS NULL AND clave <> ?1",
    )
    .bind(CLAVE_SESION)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(ConteoLocal {
        clientes: contar(&pool, "clientes").await?,
        notas_venta: contar(&pool, "notas_venta").await?,
        colores_hilo: contar(&pool, "colores_hilo").await?,
        tipos_hilo: contar(&pool, "tipos_hilo").await?,
        configuracion,
    })
}

#[derive(serde::Serialize)]
pub struct ResumenAdopcion {
    pub clientes: u64,
    pub notas_venta: u64,
    pub colores_hilo: u64,
    pub colores_hilo_descartados: u64,
    pub tipos_hilo: u64,
    pub tipos_hilo_descartados: u64,
    pub configuracion: u64,
    pub configuracion_descartada: u64,
}

/// Asocia a la cuenta activa todo lo que esté en usuario_id NULL.
///
/// En catálogos y configuración se usa `UPDATE OR IGNORE` seguido de un DELETE
/// del remanente: si el usuario ya tiene su propio 'Blanco', el 'Blanco' local
/// no puede moverse (chocaría con el índice único) y se descarta a favor del
/// que ya tenía. Los descartados se reportan para que la UI lo diga en claro.
///
/// Es idempotente: una segunda corrida no encuentra nada en NULL y devuelve
/// todo en cero.
#[tauri::command]
pub async fn adoptar_datos_locales(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
) -> Result<ResumenAdopcion, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner())
        .await?
        .ok_or("Necesitas iniciar sesión antes de adoptar datos locales.")?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let clientes = sqlx::query(
        "UPDATE clientes SET usuario_id = ?1, sync_estado = 'pendiente' WHERE usuario_id IS NULL",
    )
    .bind(&usuario_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();

    let notas_venta = sqlx::query(
        "UPDATE notas_venta SET usuario_id = ?1, sync_estado = 'pendiente' WHERE usuario_id IS NULL",
    )
    .bind(&usuario_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();

    let colores_hilo = sqlx::query(
        "UPDATE OR IGNORE colores_hilo SET usuario_id = ?1, sync_estado = 'pendiente' WHERE usuario_id IS NULL",
    )
    .bind(&usuario_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();
    let colores_hilo_descartados = sqlx::query("DELETE FROM colores_hilo WHERE usuario_id IS NULL")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected();

    let tipos_hilo = sqlx::query(
        "UPDATE OR IGNORE tipos_hilo SET usuario_id = ?1, sync_estado = 'pendiente' WHERE usuario_id IS NULL",
    )
    .bind(&usuario_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();
    let tipos_hilo_descartados = sqlx::query("DELETE FROM tipos_hilo WHERE usuario_id IS NULL")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected();

    // 'sesion_usuario_id' queda FUERA de la adopción, en el UPDATE y en el
    // DELETE. Es metadato de la instalación ("quién dejó la sesión abierta en
    // esta PC"), y vive en usuario_id NULL por diseño: leer_sesion_recordada
    // consulta justo ese alcance. Si se adoptara, la fila dejaría de ser
    // visible y la sesión se olvidaría al siguiente arranque — es decir,
    // adoptar tus datos te desloguearía la próxima vez que abras la app.
    let configuracion = sqlx::query(
        "UPDATE OR IGNORE configuracion SET usuario_id = ?1
          WHERE usuario_id IS NULL AND clave <> ?2",
    )
    .bind(&usuario_id)
    .bind(CLAVE_SESION)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();
    let configuracion_descartada = sqlx::query(
        "DELETE FROM configuracion WHERE usuario_id IS NULL AND clave <> ?1",
    )
    .bind(CLAVE_SESION)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ResumenAdopcion {
        clientes,
        notas_venta,
        colores_hilo,
        colores_hilo_descartados,
        tipos_hilo,
        tipos_hilo_descartados,
        configuracion,
        configuracion_descartada,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_hash_no_es_la_contrasena_en_claro() {
        let hash = hashear("hilo1234").unwrap();
        assert!(!hash.contains("hilo1234"));
        assert!(hash.starts_with("$argon2"));
    }

    #[test]
    fn verifica_la_contrasena_correcta_y_rechaza_la_mala() {
        let hash = hashear("hilo1234").unwrap();
        assert!(verificar("hilo1234", &hash));
        assert!(!verificar("hilo1235", &hash));
        assert!(!verificar("", &hash));
    }

    // Dos altas con la misma contraseña deben dar hashes distintos: si
    // coincidieran, la sal no estaría entrando en juego.
    #[test]
    fn la_sal_hace_unico_cada_hash() {
        assert_ne!(hashear("hilo1234").unwrap(), hashear("hilo1234").unwrap());
    }

    #[test]
    fn un_hash_corrupto_no_deja_pasar() {
        assert!(!verificar("hilo1234", "esto-no-es-un-hash"));
        assert!(!verificar("hilo1234", ""));
    }

    #[test]
    fn sync_estado_depende_de_si_hay_sesion() {
        assert_eq!(sync_estado_inicial(Some("id")), "pendiente");
        assert_eq!(sync_estado_inicial(None), "local");
    }

    // ---- Contra una SQLite real, con TODAS las migraciones aplicadas ----
    //
    // Los #[tauri::command] no se pueden llamar desde un test (necesitan un
    // State que solo existe con la app corriendo), así que se ejercitan las
    // funciones que llevan la lógica. La app cableada encima es un pasamanos.

    async fn base_migrada() -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migracion in crate::migrations::migraciones() {
            sqlx::raw_sql(migracion.sql).execute(&pool).await.unwrap();
        }
        pool
    }

    async fn alta(pool: &sqlx::SqlitePool, nombre: &str, password: &str) -> String {
        alta_con_correo(pool, nombre, &format!("{nombre}@correo.com"), password).await
    }

    async fn alta_con_correo(
        pool: &sqlx::SqlitePool,
        nombre: &str,
        correo: &str,
        password: &str,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO usuarios (id_usuario, nombre_usuario, correo, password_hash, rol)
             VALUES (?1, ?2, ?3, ?4, 'vendedor')",
        )
        .bind(&id)
        .bind(nombre)
        .bind(correo)
        .bind(hashear(password).unwrap())
        .execute(pool)
        .await
        .unwrap();
        id
    }

    /// La misma consulta que usa iniciar_sesion, para probar la resolución del
    /// identificador sin necesidad del State de Tauri.
    async fn buscar_por_identificador(
        pool: &sqlx::SqlitePool,
        identificador: &str,
    ) -> Option<String> {
        sqlx::query_scalar::<_, String>(
            "SELECT id_usuario FROM usuarios WHERE nombre_usuario = ?1 OR correo = ?1",
        )
        .bind(identificador)
        .fetch_optional(pool)
        .await
        .unwrap()
    }

    #[test]
    fn el_validador_de_correo_ataja_los_dedazos() {
        assert!(correo_valido("josafat@correo.com"));
        assert!(correo_valido("josa.fat+ventas@sub.correo.mx"));

        assert!(!correo_valido("josafat"));
        assert!(!correo_valido("josafat@"));
        assert!(!correo_valido("@correo.com"));
        assert!(!correo_valido("josafat@correo"));
        assert!(!correo_valido("josafat@.com"));
        assert!(!correo_valido("josafat@correo."));
        assert!(!correo_valido("uno@dos@correo.com"));
        assert!(!correo_valido(""));
    }

    #[tokio::test]
    async fn el_nombre_de_usuario_es_unico_sin_importar_mayusculas() {
        let pool = base_migrada().await;
        alta(&pool, "Josafat", "hilo1234").await;

        let repetido = sqlx::query("INSERT INTO usuarios (id_usuario, nombre_usuario, correo, password_hash) VALUES ('otro', 'josafat', 'otro@correo.com', 'x')")
            .execute(&pool)
            .await;
        assert!(repetido.is_err(), "COLLATE NOCASE debería bloquear el duplicado");
    }

    #[tokio::test]
    async fn el_correo_es_unico_sin_importar_mayusculas() {
        let pool = base_migrada().await;
        alta_con_correo(&pool, "Josafat", "Josafat@Correo.com", "hilo1234").await;

        let repetido = sqlx::query("INSERT INTO usuarios (id_usuario, nombre_usuario, correo, password_hash) VALUES ('otro', 'Otro', 'josafat@correo.com', 'x')")
            .execute(&pool)
            .await;
        assert!(repetido.is_err(), "el correo debería chocar ignorando mayúsculas");
    }

    // Lo que pide el login: entrar con cualquiera de los dos datos, escrito
    // con las mayúsculas que sea.
    #[tokio::test]
    async fn se_entra_con_nombre_o_con_correo_ignorando_mayusculas() {
        let pool = base_migrada().await;
        let id = alta_con_correo(&pool, "Josafat", "Josafat@Correo.com", "hilo1234").await;

        for identificador in [
            "Josafat",
            "josafat",
            "JOSAFAT",
            "Josafat@Correo.com",
            "josafat@correo.com",
            "JOSAFAT@CORREO.COM",
        ] {
            assert_eq!(
                buscar_por_identificador(&pool, identificador).await.as_deref(),
                Some(id.as_str()),
                "no resolvió «{identificador}»"
            );
        }

        assert_eq!(buscar_por_identificador(&pool, "no-existe").await, None);
    }

    // El flujo que importa: iniciar sesión, "reiniciar la app" (estado en
    // memoria nuevo y vacío) y que la sesión siga ahí sin volver a pedir nada.
    #[tokio::test]
    async fn la_sesion_sobrevive_al_reinicio_de_la_app() {
        let pool = base_migrada().await;
        let id = alta(&pool, "Josafat", "hilo1234").await;

        recordar_sesion(&pool, Some(&id)).await.unwrap();

        let tras_reiniciar: EstadoSesion = Mutex::new(None);
        let recuperado = usuario_id_de_sesion(&pool, &tras_reiniciar).await.unwrap();
        assert_eq!(recuperado.as_deref(), Some(id.as_str()));
        // Y queda cacheado en memoria para las siguientes llamadas.
        assert_eq!(tras_reiniciar.lock().unwrap().as_deref(), Some(id.as_str()));
    }

    #[tokio::test]
    async fn cerrar_sesion_borra_la_fila_recordada() {
        let pool = base_migrada().await;
        let id = alta(&pool, "Josafat", "hilo1234").await;

        recordar_sesion(&pool, Some(&id)).await.unwrap();
        recordar_sesion(&pool, None).await.unwrap();

        assert_eq!(leer_sesion_recordada(&pool).await.unwrap(), None);
        let estado: EstadoSesion = Mutex::new(None);
        assert_eq!(usuario_id_de_sesion(&pool, &estado).await.unwrap(), None);
    }

    // Guardar dos veces la sesión debe actualizar la fila, no acumularlas.
    // Es lo que verifica que el ON CONFLICT apunte al índice correcto.
    #[tokio::test]
    async fn recordar_la_sesion_dos_veces_no_duplica_la_fila() {
        let pool = base_migrada().await;
        let uno = alta(&pool, "Josafat", "hilo1234").await;
        let dos = alta(&pool, "Ana", "hilo1234").await;

        recordar_sesion(&pool, Some(&uno)).await.unwrap();
        recordar_sesion(&pool, Some(&dos)).await.unwrap();

        let filas: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM configuracion WHERE clave = 'sesion_usuario_id'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(filas, 1, "la sesión recordada se duplicó");
        assert_eq!(leer_sesion_recordada(&pool).await.unwrap().as_deref(), Some(dos.as_str()));
    }

    // ---- Registro y login de punta a punta ----
    //
    // Estos sí pasan por registrar_usuario_en / iniciar_sesion_en, que es el
    // mismo código que corre el comando; lo único que no se ejercita es el
    // desempaque del State de Tauri.

    const PWD: &str = "hilo1234";

    #[tokio::test]
    async fn registro_y_login_con_nombre_o_correo() {
        let pool = base_migrada().await;

        let creado = registrar_usuario_en(&pool, "Josafat", "Josafat@correo.com", PWD)
            .await
            .expect("el alta debería funcionar");
        assert_eq!(creado.nombre_usuario, "Josafat");
        assert_eq!(creado.correo, "Josafat@correo.com");
        assert_eq!(creado.rol, "vendedor");

        // Con el nombre de usuario.
        let estado: EstadoSesion = Mutex::new(None);
        let entrada = iniciar_sesion_en(&pool, &estado, "Josafat", PWD).await.unwrap();
        assert_eq!(entrada.id_usuario, creado.id_usuario);

        // Cerrar sesión y volver a entrar, ahora con el correo.
        recordar_sesion(&pool, None).await.unwrap();
        let estado: EstadoSesion = Mutex::new(None);
        let entrada = iniciar_sesion_en(&pool, &estado, "Josafat@correo.com", PWD)
            .await
            .unwrap();
        assert_eq!(entrada.id_usuario, creado.id_usuario);
    }

    // Punto 3 del plan de pruebas: se registra con unas mayúsculas y se entra
    // con otras, gracias al COLLATE NOCASE de las dos columnas.
    #[tokio::test]
    async fn se_entra_ignorando_mayusculas_en_ambos_campos() {
        let pool = base_migrada().await;
        let creado = registrar_usuario_en(&pool, "Josafat", "Josafat@correo.com", PWD)
            .await
            .unwrap();

        for identificador in ["josafat", "JOSAFAT", "josafat@correo.com", "JOSAFAT@CORREO.COM"] {
            let estado: EstadoSesion = Mutex::new(None);
            let entrada = iniciar_sesion_en(&pool, &estado, identificador, PWD)
                .await
                .unwrap_or_else(|e| panic!("«{identificador}» no entró: {e}"));
            assert_eq!(entrada.id_usuario, creado.id_usuario);
        }
    }

    #[tokio::test]
    async fn el_nombre_repetido_da_su_propio_mensaje() {
        let pool = base_migrada().await;
        registrar_usuario_en(&pool, "Josafat", "josafat@correo.com", PWD).await.unwrap();

        let error = registrar_usuario_en(&pool, "josafat", "otro@correo.com", PWD)
            .await
            .unwrap_err();
        assert_eq!(error, "Ese nombre de usuario ya está en uso.");
    }

    #[tokio::test]
    async fn el_correo_repetido_da_su_propio_mensaje() {
        let pool = base_migrada().await;
        registrar_usuario_en(&pool, "Josafat", "josafat@correo.com", PWD).await.unwrap();

        let error = registrar_usuario_en(&pool, "Otro", "JOSAFAT@correo.com", PWD)
            .await
            .unwrap_err();
        assert_eq!(error, "Ese correo ya está registrado.");
    }

    // Si chocan los dos, gana el mensaje del correo: es el dato con el que la
    // persona reconoce más fácil que ya tiene cuenta.
    #[tokio::test]
    async fn si_chocan_los_dos_gana_el_mensaje_del_correo() {
        let pool = base_migrada().await;
        registrar_usuario_en(&pool, "Josafat", "josafat@correo.com", PWD).await.unwrap();

        let error = registrar_usuario_en(&pool, "Josafat", "josafat@correo.com", PWD)
            .await
            .unwrap_err();
        assert_eq!(error, "Ese correo ya está registrado.");
    }

    #[tokio::test]
    async fn el_alta_rechaza_un_correo_mal_escrito() {
        let pool = base_migrada().await;
        for malo in ["josafat", "josafat@", "@correo.com", "josafat@correo"] {
            let error = registrar_usuario_en(&pool, "Josafat", malo, PWD).await.unwrap_err();
            assert_eq!(error, "Ese correo no parece válido. Revisa que esté completo.");
        }
        // Y no dejó nada a medias en la tabla.
        let filas: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usuarios")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(filas, 0);
    }

    // Punto 4: el mensaje tiene que ser IDÉNTICO cuando el identificador no
    // existe y cuando la contraseña está mal. Si difirieran, el login serviría
    // para averiguar qué correos están registrados.
    #[tokio::test]
    async fn el_error_de_login_no_distingue_usuario_de_password() {
        let pool = base_migrada().await;
        registrar_usuario_en(&pool, "Josafat", "josafat@correo.com", PWD).await.unwrap();

        let estado: EstadoSesion = Mutex::new(None);
        let inexistente = iniciar_sesion_en(&pool, &estado, "noexiste", PWD).await.unwrap_err();
        let mala_password = iniciar_sesion_en(&pool, &estado, "Josafat", "otra-cosa")
            .await
            .unwrap_err();
        let correo_inexistente =
            iniciar_sesion_en(&pool, &estado, "nadie@correo.com", PWD).await.unwrap_err();

        assert_eq!(inexistente, "Usuario o contraseña incorrectos.");
        assert_eq!(mala_password, inexistente);
        assert_eq!(correo_inexistente, inexistente);
    }

    #[tokio::test]
    async fn el_identificador_vacio_se_ataja_antes_de_consultar() {
        let pool = base_migrada().await;
        let estado: EstadoSesion = Mutex::new(None);
        assert_eq!(
            iniciar_sesion_en(&pool, &estado, "   ", PWD).await.unwrap_err(),
            "Ingresa tu usuario o correo."
        );
    }

    // ---- Adopción de datos locales ----
    //
    // El comando necesita State, que solo existe con la app corriendo, así que
    // los tests ejecutan el mismo SQL contra el pool. Si se toca el comando,
    // hay que tocar esto: es la copia que se puede probar.

    async fn adoptar(pool: &sqlx::SqlitePool, usuario_id: &str) -> (u64, u64, u64, u64) {
        let colores = sqlx::query(
            "UPDATE OR IGNORE colores_hilo SET usuario_id = ?1, sync_estado = 'pendiente' WHERE usuario_id IS NULL",
        ).bind(usuario_id).execute(pool).await.unwrap().rows_affected();
        let descartados = sqlx::query("DELETE FROM colores_hilo WHERE usuario_id IS NULL")
            .execute(pool).await.unwrap().rows_affected();
        let cfg = sqlx::query(
            "UPDATE OR IGNORE configuracion SET usuario_id = ?1 WHERE usuario_id IS NULL AND clave <> ?2",
        ).bind(usuario_id).bind(CLAVE_SESION).execute(pool).await.unwrap().rows_affected();
        let cfg_descartada = sqlx::query(
            "DELETE FROM configuracion WHERE usuario_id IS NULL AND clave <> ?1",
        ).bind(CLAVE_SESION).execute(pool).await.unwrap().rows_affected();
        (colores, descartados, cfg, cfg_descartada)
    }

    // Lo que la migración v4 dejó: 12 colores sin dueño.
    #[tokio::test]
    async fn adoptar_mueve_el_catalogo_local_a_la_cuenta() {
        let pool = base_migrada().await;
        let id = alta(&pool, "Josafat", "hilo1234").await;

        let (colores, descartados, _, _) = adoptar(&pool, &id).await;
        assert_eq!(colores, 12);
        assert_eq!(descartados, 0);

        let sin_duenio: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM colores_hilo WHERE usuario_id IS NULL")
                .fetch_one(&pool).await.unwrap();
        assert_eq!(sin_duenio, 0);

        let pendientes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM colores_hilo WHERE usuario_id = ?1 AND sync_estado = 'pendiente'",
        ).bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(pendientes, 12);
    }

    #[tokio::test]
    async fn adoptar_dos_veces_seguidas_no_truena_y_devuelve_cero() {
        let pool = base_migrada().await;
        let id = alta(&pool, "Josafat", "hilo1234").await;

        adoptar(&pool, &id).await;
        let (colores, descartados, cfg, cfg_descartada) = adoptar(&pool, &id).await;
        assert_eq!((colores, descartados, cfg, cfg_descartada), (0, 0, 0, 0));
    }

    // El usuario ya tiene su propio 'Blanco': el local no puede moverse y se
    // descarta, sin dejar duplicados ni abortar el resto de la adopción.
    #[tokio::test]
    async fn un_color_repetido_se_descarta_en_vez_de_duplicarse() {
        let pool = base_migrada().await;
        let id = alta(&pool, "Josafat", "hilo1234").await;
        sqlx::query("INSERT INTO colores_hilo (usuario_id, nombre, sync_estado) VALUES (?1,'Blanco','pendiente')")
            .bind(&id).execute(&pool).await.unwrap();

        let (colores, descartados, _, _) = adoptar(&pool, &id).await;
        assert_eq!(colores, 11, "los 11 que no chocaban");
        assert_eq!(descartados, 1, "el 'Blanco' local");

        let blancos: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM colores_hilo WHERE nombre = 'Blanco'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(blancos, 1);
    }

    // La regresión que motivó excluir CLAVE_SESION: si la fila de sesión se
    // adoptara, dejaría de verse desde el alcance NULL y adoptar tus datos te
    // desconectaría al siguiente arranque.
    #[tokio::test]
    async fn adoptar_no_se_lleva_la_sesion_recordada() {
        let pool = base_migrada().await;
        let id = alta(&pool, "Josafat", "hilo1234").await;
        recordar_sesion(&pool, Some(&id)).await.unwrap();
        sqlx::query("INSERT INTO configuracion (usuario_id, clave, valor) VALUES (NULL,'maneja_tipos_hilo','si')")
            .execute(&pool).await.unwrap();

        let (_, _, cfg, _) = adoptar(&pool, &id).await;
        assert_eq!(cfg, 1, "solo maneja_tipos_hilo");

        // La sesión sigue donde la busca leer_sesion_recordada.
        assert_eq!(leer_sesion_recordada(&pool).await.unwrap().as_deref(), Some(id.as_str()));
        let tras_reiniciar: EstadoSesion = Mutex::new(None);
        assert_eq!(
            usuario_id_de_sesion(&pool, &tras_reiniciar).await.unwrap().as_deref(),
            Some(id.as_str())
        );
    }

    // Base restaurada de otra PC, o usuario borrado a mano: la sesión apunta a
    // alguien que ya no está. No debe arrastrarse ese id a las filas nuevas.
    #[tokio::test]
    async fn una_sesion_de_usuario_inexistente_se_descarta() {
        let pool = base_migrada().await;
        recordar_sesion(&pool, Some("id-que-no-existe")).await.unwrap();

        let estado: EstadoSesion = Mutex::new(None);
        assert_eq!(usuario_id_de_sesion(&pool, &estado).await.unwrap(), None);
        // Y además se limpia, para no repetir la consulta fallida cada vez.
        assert_eq!(leer_sesion_recordada(&pool).await.unwrap(), None);
    }
}
