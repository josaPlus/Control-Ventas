use serde::Deserialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::auth::{sync_estado_inicial, usuario_id_de_sesion, EstadoSesion};
use crate::db::obtener_pool;
use crate::sync::{marcar_pendiente, TablaSync};

#[derive(Deserialize)]
pub struct ClienteInput {
    comprador: String,
    domicilio: String,
    telefono: String,
}

// Alta de cliente. Hasta ahora este INSERT vivía en el frontend
// (src/db/database.ts, crearCliente); se trae a Rust porque desde la v3 la fila
// necesita usuario_id y sync_estado, y quién tiene la sesión abierta solo se
// sabe de este lado.
#[tauri::command]
pub async fn crear_cliente(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    cliente: ClienteInput,
) -> Result<i64, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;

    // Explícitos aunque el DEFAULT de la tabla coincida, igual que en ventas.
    let resultado = sqlx::query(
        "INSERT INTO clientes (comprador, domicilio, telefono, usuario_id, sync_estado)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&cliente.comprador)
    .bind(&cliente.domicilio)
    .bind(&cliente.telefono)
    .bind(usuario_id.as_deref())
    .bind(sync_estado_inicial(usuario_id.as_deref()))
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(resultado.last_insert_rowid())
}

// Edición real disparada por el usuario, así que vuelve a la cola de sync.
// usuario_id no se toca: el cliente conserva a quien lo dio de alta.
#[tauri::command]
pub async fn actualizar_cliente(
    db_instances: State<'_, DbInstances>,
    cliente_id: i64,
    cliente: ClienteInput,
) -> Result<(), String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let resultado = sqlx::query(
        "UPDATE clientes SET comprador = ?1, domicilio = ?2, telefono = ?3 WHERE id = ?4",
    )
    .bind(&cliente.comprador)
    .bind(&cliente.domicilio)
    .bind(&cliente.telefono)
    .bind(cliente_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if resultado.rows_affected() == 0 {
        return Err("El cliente que intentas editar ya no existe.".into());
    }

    marcar_pendiente(&mut *tx, TablaSync::Clientes, cliente_id).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

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