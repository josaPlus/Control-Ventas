use tauri_plugin_sql::{DbInstances, DbPool};

pub const DB_URL: &str = "sqlite:ventas.db";

// El pool es un Arc por dentro, así que clonarlo es barato y nos deja soltar
// el candado de lectura antes de empezar a trabajar contra la base.
pub async fn obtener_pool(db_instances: &DbInstances) -> Result<sqlx::SqlitePool, String> {
    let instances = db_instances.0.read().await;
    let pool = instances
        .get(DB_URL)
        .ok_or_else(|| format!("La base de datos {DB_URL} no está cargada."))?;

    match pool {
        DbPool::Sqlite(pool) => Ok(pool.clone()),
        #[allow(unreachable_patterns)]
        _ => Err("La conexión activa no es SQLite.".into()),
    }
}