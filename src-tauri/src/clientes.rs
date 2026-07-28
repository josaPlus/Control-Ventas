use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db::obtener_pool;

// Borra un cliente sólo si no tiene ventas registradas. El conteo y el borrado
// van en la misma transacción para que no se pueda colar una venta nueva justo
// entre los dos pasos.
#[tauri::command]
pub async fn eliminar_cliente(
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