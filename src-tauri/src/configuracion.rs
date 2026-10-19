//! Lectura y escritura de `configuracion`, acotada por sesión.
//!
//! Desde la v4 la tabla tiene alcance por usuario, así que estas consultas no
//! pueden seguir viviendo en el frontend con un `usuario_id IS NULL` fijo:
//! en cuanto se adoptan los datos locales, la fila cambia de alcance y el
//! frontend dejaría de encontrarla. Concretamente, `maneja_tipos_hilo`
//! desaparecería y el asistente de bienvenida volvería a salirle a alguien que
//! lleva meses capturando ventas.

use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::auth::{usuario_id_de_sesion, EstadoSesion};
use crate::db::obtener_pool;

/// Lee la clave en el alcance de la sesión y, si ahí no hay nada, cae al
/// alcance local (usuario_id NULL).
///
/// La caída es lo que hace que iniciar sesión no borre de golpe la
/// configuración de la PC: mientras el usuario no adopte ni cambie nada, sigue
/// viendo los ajustes que ya había. Después de adoptar, el valor ya vive bajo
/// su cuenta y se encuentra en el primer intento.
#[tauri::command]
pub async fn leer_configuracion(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    clave: String,
) -> Result<Option<String>, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;

    let propio: Option<String> = sqlx::query_scalar(
        "SELECT valor FROM configuracion WHERE clave = ?1 AND usuario_id IS ?2",
    )
    .bind(&clave)
    .bind(usuario_id.as_deref())
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if propio.is_some() || usuario_id.is_none() {
        return Ok(propio);
    }

    sqlx::query_scalar("SELECT valor FROM configuracion WHERE clave = ?1 AND usuario_id IS NULL")
        .bind(&clave)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())
}

/// Guarda siempre en el alcance de quien está operando. Sin sesión, en el
/// local; con sesión, bajo esa cuenta.
#[tauri::command]
pub async fn guardar_configuracion(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    clave: String,
    valor: String,
) -> Result<(), String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;

    // El ON CONFLICT tiene que nombrar la restricción exacta y son dos
    // distintas: con usuario_id real manda la PK (usuario_id, clave); con NULL
    // la PK no aplica (dos NULL no son iguales entre sí) y quien hace cumplir
    // la unicidad es el índice parcial de la v4, que se nombra con su WHERE.
    match usuario_id {
        Some(id) => {
            sqlx::query(
                "INSERT INTO configuracion (usuario_id, clave, valor) VALUES (?1, ?2, ?3)
                 ON CONFLICT(usuario_id, clave) DO UPDATE SET valor = excluded.valor",
            )
            .bind(&id)
            .bind(&clave)
            .bind(&valor)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
        }
        None => {
            sqlx::query(
                "INSERT INTO configuracion (usuario_id, clave, valor) VALUES (NULL, ?1, ?2)
                 ON CONFLICT(clave) WHERE usuario_id IS NULL
                 DO UPDATE SET valor = excluded.valor",
            )
            .bind(&clave)
            .bind(&valor)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
