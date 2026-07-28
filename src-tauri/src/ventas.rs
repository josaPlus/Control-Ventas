use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::catalogos::{registrar_en_catalogo, normalizar_nombre, Catalogo};
use crate::db::obtener_pool;

#[derive(Deserialize)]
pub struct NotaVentaInput {
    cliente_id: i64,
    fecha: String,
    tipo_deposito: String,
    pagado: bool,
    #[serde(default)]
    comentario: Option<String>,
    total_venta: f64,
}

#[derive(Deserialize)]
pub struct DetalleVentaInput {
    color_pina: String,
    cantidad_pinas: i64,
    precio_pina: f64,
    // Opcional: el negocio que maneja un solo tipo de hilo nunca lo envía.
    #[serde(default)]
    tipo_hilo: Option<String>,
    subtotal: f64,
}

#[derive(Serialize)]
pub struct NotaVentaCreada {
    id: i64,
    numero_nota: i64,
}

/// Normaliza color y tipo de cada línea antes de tocar la base, para que el
/// texto que se guarda en la venta y el que entra al catálogo sean el mismo.
/// Un tipo que quede vacío se convierte en None, que en SQLite es NULL.
fn normalizar_detalles(detalles: &mut [DetalleVentaInput]) {
    for detalle in detalles.iter_mut() {
        detalle.color_pina = normalizar_nombre(&detalle.color_pina);
        detalle.tipo_hilo = detalle
            .tipo_hilo
            .as_deref()
            .map(normalizar_nombre)
            .filter(|t| !t.is_empty());
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
                (nota_venta_id, color_pina, cantidad_pinas, precio_pina, subtotal, tipo_hilo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(nota_venta_id)
        .bind(&detalle.color_pina)
        .bind(detalle.cantidad_pinas)
        .bind(detalle.precio_pina)
        .bind(detalle.subtotal)
        .bind(detalle.tipo_hilo.as_deref())
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Alimenta ambos catálogos con lo que traiga la nota. Se llama dentro de la
/// misma transacción que guarda la venta: si la venta se revierte, el catálogo
/// no queda con valores de una venta que nunca existió.
async fn registrar_catalogos_de_la_nota(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    detalles: &[DetalleVentaInput],
) -> Result<(), String> {
    let colores: Vec<String> = detalles.iter().map(|d| d.color_pina.clone()).collect();
    registrar_en_catalogo(tx, Catalogo::ColoresHilo, colores).await?;

    let tipos: Vec<String> = detalles.iter().filter_map(|d| d.tipo_hilo.clone()).collect();
    registrar_en_catalogo(tx, Catalogo::TiposHilo, tipos).await?;

    Ok(())
}

// Guarda la nota de venta y todas sus líneas de detalle en UNA sola transacción.
//
// Esto no se puede hacer desde JS con el plugin de SQL: cada llamada a execute()
// toma una conexión distinta del pool, así que un "BEGIN" por un lado y el
// "INSERT" por otro terminan en "database is locked". Aquí tomamos una única
// conexión y la transacción es real: o se guarda todo, o no se guarda nada.
#[tauri::command]
pub async fn crear_nota_venta(
    db_instances: State<'_, DbInstances>,
    nota: NotaVentaInput,
    mut detalles: Vec<DetalleVentaInput>,
) -> Result<NotaVentaCreada, String> {
    if detalles.is_empty() {
        return Err("La nota debe tener al menos una línea de detalle.".into());
    }
    normalizar_detalles(&mut detalles);

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
    registrar_catalogos_de_la_nota(&mut tx, &detalles).await?;

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
pub async fn actualizar_nota_venta(
    db_instances: State<'_, DbInstances>,
    nota_venta_id: i64,
    nota: NotaVentaInput,
    mut detalles: Vec<DetalleVentaInput>,
) -> Result<(), String> {
    if detalles.is_empty() {
        return Err("La nota debe tener al menos una línea de detalle.".into());
    }
    normalizar_detalles(&mut detalles);

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
    registrar_catalogos_de_la_nota(&mut tx, &detalles).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

// Borra la nota y sus detalles. Sin transacción quedarían líneas de detalle
// huérfanas apuntando a una nota que ya no existe.
#[tauri::command]
pub async fn eliminar_nota_venta(
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