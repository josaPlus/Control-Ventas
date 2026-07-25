use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

const DB_URL: &str = "sqlite:ventas.db";

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Deserialize)]
struct NotaVentaInput {
    cliente_id: i64,
    fecha: String,
    tipo_deposito: String,
    pagado: bool,
    #[serde(default)]
    comentario: Option<String>,
    total_venta: f64,
}

#[derive(Deserialize)]
struct DetalleVentaInput {
    color_pina: String,
    cantidad_pinas: i64,
    precio_pina: f64,
    subtotal: f64,
}

#[derive(Serialize)]
struct NotaVentaCreada {
    id: i64,
    numero_nota: i64,
}

// El pool es un Arc por dentro, así que clonarlo es barato y nos deja soltar
// el candado de lectura antes de empezar a trabajar contra la base.
async fn obtener_pool(db_instances: &DbInstances) -> Result<sqlx::SqlitePool, String> {
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

// Inserta las líneas de detalle de una nota. Se usa al crear y al editar.
async fn insertar_detalles(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    nota_venta_id: i64,
    detalles: &[DetalleVentaInput],
) -> Result<(), String> {
    for detalle in detalles {
        sqlx::query(
            "INSERT INTO detalle_venta
                (nota_venta_id, color_pina, cantidad_pinas, precio_pina, subtotal)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(nota_venta_id)
        .bind(&detalle.color_pina)
        .bind(detalle.cantidad_pinas)
        .bind(detalle.precio_pina)
        .bind(detalle.subtotal)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Guarda la nota de venta y todas sus líneas de detalle en UNA sola transacción.
//
// Esto no se puede hacer desde JS con el plugin de SQL: cada llamada a execute()
// toma una conexión distinta del pool, así que un "BEGIN" por un lado y el
// "INSERT" por otro terminan en "database is locked". Aquí tomamos una única
// conexión y la transacción es real: o se guarda todo, o no se guarda nada.
#[tauri::command]
async fn crear_nota_venta(
    db_instances: State<'_, DbInstances>,
    nota: NotaVentaInput,
    detalles: Vec<DetalleVentaInput>,
) -> Result<NotaVentaCreada, String> {
    if detalles.is_empty() {
        return Err("La nota debe tener al menos una línea de detalle.".into());
    }

    let pool = obtener_pool(db_instances.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Dentro de la transacción, así dos ventas simultáneas no pueden tomar el
    // mismo número de nota.
    let numero_nota: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(numero_nota), 0) + 1 FROM notas_venta")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    let resultado = sqlx::query(
        "INSERT INTO notas_venta
            (numero_nota, cliente_id, fecha, tipo_deposito, pagado, comentario, total_venta)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(numero_nota)
    .bind(nota.cliente_id)
    .bind(&nota.fecha)
    .bind(&nota.tipo_deposito)
    .bind(if nota.pagado { 1_i64 } else { 0_i64 })
    .bind(nota.comentario.as_deref())
    .bind(nota.total_venta)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let nota_venta_id = resultado.last_insert_rowid();

    insertar_detalles(&mut tx, nota_venta_id, &detalles).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(NotaVentaCreada {
        id: nota_venta_id,
        numero_nota,
    })
}

// Reemplaza el contenido de una nota existente. El número de nota NO cambia:
// es el folio con el que el cliente ya tiene su copia.
//
// Los detalles se borran y se vuelven a insertar en lugar de intentar casarlos
// uno a uno: el usuario puede agregar, quitar o reordenar líneas, y todo pasa
// dentro de la misma transacción.
#[tauri::command]
async fn actualizar_nota_venta(
    db_instances: State<'_, DbInstances>,
    nota_venta_id: i64,
    nota: NotaVentaInput,
    detalles: Vec<DetalleVentaInput>,
) -> Result<(), String> {
    if detalles.is_empty() {
        return Err("La nota debe tener al menos una línea de detalle.".into());
    }

    let pool = obtener_pool(db_instances.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let resultado = sqlx::query(
        "UPDATE notas_venta
            SET cliente_id = ?1, fecha = ?2, tipo_deposito = ?3,
                pagado = ?4, comentario = ?5, total_venta = ?6
          WHERE id = ?7",
    )
    .bind(nota.cliente_id)
    .bind(&nota.fecha)
    .bind(&nota.tipo_deposito)
    .bind(if nota.pagado { 1_i64 } else { 0_i64 })
    .bind(nota.comentario.as_deref())
    .bind(nota.total_venta)
    .bind(nota_venta_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if resultado.rows_affected() == 0 {
        return Err("La nota de venta que intentas editar ya no existe.".into());
    }

    sqlx::query("DELETE FROM detalle_venta WHERE nota_venta_id = ?1")
        .bind(nota_venta_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    insertar_detalles(&mut tx, nota_venta_id, &detalles).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

// Borra la nota y sus detalles. Sin transacción quedarían líneas de detalle
// huérfanas apuntando a una nota que ya no existe.
#[tauri::command]
async fn eliminar_nota_venta(
    db_instances: State<'_, DbInstances>,
    nota_venta_id: i64,
) -> Result<(), String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM detalle_venta WHERE nota_venta_id = ?1")
        .bind(nota_venta_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let resultado = sqlx::query("DELETE FROM notas_venta WHERE id = ?1")
        .bind(nota_venta_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if resultado.rows_affected() == 0 {
        return Err("La nota de venta que intentas eliminar ya no existe.".into());
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

// Borra un cliente sólo si no tiene ventas registradas. El conteo y el borrado
// van en la misma transacción para que no se pueda colar una venta nueva justo
// entre los dos pasos.
#[tauri::command]
async fn eliminar_cliente(
    db_instances: State<'_, DbInstances>,
    cliente_id: i64,
) -> Result<(), String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let notas: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notas_venta WHERE cliente_id = ?1")
        .bind(cliente_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if notas > 0 {
        return Err(format!(
            "Este cliente tiene {notas} nota{} de venta registrada{}. \
             Elimina primero esas ventas en el Historial si de verdad quieres borrarlo.",
            if notas == 1 { "" } else { "s" },
            if notas == 1 { "" } else { "s" },
        ));
    }

    let resultado = sqlx::query("DELETE FROM clientes WHERE id = ?1")
        .bind(cliente_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if resultado.rows_affected() == 0 {
        return Err("El cliente que intentas eliminar ya no existe.".into());
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "crear_tablas_iniciales",
        sql: "
                CREATE TABLE clientes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    comprador TEXT NOT NULL,
                    domicilio TEXT NOT NULL,
                    telefono TEXT NOT NULL
                );

                CREATE TABLE notas_venta (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero_nota INTEGER NOT NULL,
                    cliente_id INTEGER NOT NULL,
                    fecha TEXT NOT NULL,
                    tipo_deposito TEXT NOT NULL,
                    pagado INTEGER NOT NULL DEFAULT 0,
                    comentario TEXT,
                    total_venta REAL NOT NULL DEFAULT 0,
                    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
                );

                CREATE TABLE detalle_venta (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nota_venta_id INTEGER NOT NULL,
                    color_pina TEXT NOT NULL,
                    cantidad_pinas INTEGER NOT NULL,
                    precio_pina REAL NOT NULL,
                    subtotal REAL NOT NULL,
                    FOREIGN KEY (nota_venta_id) REFERENCES notas_venta(id)
                );
            ",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            crear_nota_venta,
            actualizar_nota_venta,
            eliminar_nota_venta,
            eliminar_cliente
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
