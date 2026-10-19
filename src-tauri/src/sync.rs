//! Marcado de filas pendientes de sincronizar.
//!
//! Aquí NO hay red, ni cliente HTTP, ni tareas en segundo plano: solo se deja
//! constancia en la base de qué cambió. Cuando exista el servidor, el que
//! recorra las filas 'pendiente' y las suba será otro módulo; este seguirá
//! sirviendo igual.

/// Lista blanca de tablas marcables. El nombre de tabla se interpola en el SQL
/// (no se puede bindear), así que la única forma de que no entre texto
/// arbitrario es que provenga de este enum. Mismo patrón que `Catalogo`.
#[derive(Clone, Copy)]
pub enum TablaSync {
    Clientes,
    NotasVenta,
    ColoresHilo,
    TiposHilo,
}

impl TablaSync {
    fn tabla(self) -> &'static str {
        match self {
            TablaSync::Clientes => "clientes",
            TablaSync::NotasVenta => "notas_venta",
            TablaSync::ColoresHilo => "colores_hilo",
            TablaSync::TiposHilo => "tipos_hilo",
        }
    }
}

/// Marca una fila como pendiente de subir.
///
/// Se llama SOLO desde ediciones reales hechas por el usuario. Nada interno
/// (por ejemplo el futuro relleno perezoso de uuid) debe pasar por aquí: eso
/// no es un cambio de datos del negocio y ensuciaría la cola de sincronización
/// con filas que en realidad no cambiaron.
///
/// Una fila sin `usuario_id` se queda en 'local' y no se toca: sin login no hay
/// destino al cual sincronizarla. Por eso el WHERE lleva `usuario_id IS NOT NULL`
/// en vez de resolverse en Rust — así no hay forma de saltarse la regla.
pub async fn marcar_pendiente(
    ejecutor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    tabla: TablaSync,
    id: i64,
) -> Result<(), String> {
    sqlx::query(&format!(
        "UPDATE {} SET sync_estado = 'pendiente'
          WHERE id = ?1 AND usuario_id IS NOT NULL",
        tabla.tabla()
    ))
    .bind(id)
    .execute(ejecutor)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
