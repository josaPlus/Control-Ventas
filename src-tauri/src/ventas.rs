use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::auth::{sync_estado_inicial, usuario_id_de_sesion, EstadoSesion};
use crate::catalogos::{registrar_en_catalogo, normalizar_nombre, Catalogo};
use crate::db::obtener_pool;
use crate::sync::{marcar_pendiente, TablaSync};

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

// Misma clave que CLAVE_FOLIO_INICIAL en src/db/database.ts. Es clave de
// instalación (ver auth::CLAVES_DE_INSTALACION): vive siempre con usuario_id
// NULL y la adopción no se la lleva, porque la numeración es de toda la base.
pub const CLAVE_FOLIO_INICIAL: &str = "folio_inicial";

// Tope razonable para un folio en papel. Evita que un valor enorme lleve a
// MAX(numero_nota) + 1 cerca del límite de i64.
const FOLIO_MAXIMO: i64 = 999_999_999;

#[derive(Serialize)]
pub struct NumeracionNotas {
    siguiente: i64,
    // None cuando todavía no hay notas. Ajustes la usa para rechazar un folio
    // que chocaría con una nota que ya existe.
    ultima: Option<i64>,
}

// El valor se valida aquí y no con CAST en SQL: SQLite convierte '3000abc' en
// 3000 y '1e5' en 1, y eso no es un folio válido. Cualquier cosa rara se
// ignora y la numeración se comporta como antes de existir el ajuste.
fn interpretar_folio(valor: &str) -> Option<i64> {
    valor
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|n| (1..=FOLIO_MAXIMO).contains(n))
}

// Única fuente de la regla del número de nota. El folio inicial funciona como
// piso, no como reinicio: la numeración nunca retrocede ni repite un número.
async fn calcular_numeracion(conn: &mut sqlx::SqliteConnection) -> Result<NumeracionNotas, String> {
    let ultima: Option<i64> = sqlx::query_scalar("SELECT MAX(numero_nota) FROM notas_venta")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let folio: Option<String> = sqlx::query_scalar(
        "SELECT valor FROM configuracion WHERE clave = ?1 AND usuario_id IS NULL",
    )
    .bind(CLAVE_FOLIO_INICIAL)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let piso = folio.as_deref().and_then(interpretar_folio).unwrap_or(1);

    Ok(NumeracionNotas {
        siguiente: (ultima.unwrap_or(0) + 1).max(piso),
        ultima,
    })
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
    usuario_id: Option<&str>,
    detalles: &[DetalleVentaInput],
) -> Result<(), String> {
    let colores: Vec<String> = detalles.iter().map(|d| d.color_pina.clone()).collect();
    registrar_en_catalogo(tx, Catalogo::ColoresHilo, usuario_id, colores).await?;

    let tipos: Vec<String> = detalles.iter().filter_map(|d| d.tipo_hilo.clone()).collect();
    registrar_en_catalogo(tx, Catalogo::TiposHilo, usuario_id, tipos).await?;

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
    estado: State<'_, EstadoSesion>,
    nota: NotaVentaInput,
    mut detalles: Vec<DetalleVentaInput>,
) -> Result<NotaVentaCreada, String> {
    if detalles.is_empty() {
        return Err("La nota debe tener al menos una línea de detalle.".into());
    }
    normalizar_detalles(&mut detalles);

    let pool = obtener_pool(db_instances.inner()).await?;
    // Se resuelve antes de abrir la transacción: quién está operando no depende
    // de lo que se va a escribir, y así no se ocupa la conexión de más.
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Dentro de la transacción, así dos ventas simultáneas no pueden tomar el
    // mismo número de nota.
    let numero_nota = calcular_numeracion(&mut tx).await?.siguiente;

    // usuario_id y sync_estado se escriben explícitos aunque la tabla ya tenga
    // DEFAULT 'local': el significado de la escritura no debe depender de que
    // nadie cambie el default más adelante.
    let resultado = sqlx::query(
        "INSERT INTO notas_venta
            (numero_nota, cliente_id, fecha, tipo_deposito, pagado, comentario,
             total_venta, usuario_id, sync_estado)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(numero_nota)
    .bind(nota.cliente_id)
    .bind(&nota.fecha)
    .bind(&nota.tipo_deposito)
    .bind(if nota.pagado { 1_i64 } else { 0_i64 })
    .bind(nota.comentario.as_deref())
    .bind(nota.total_venta)
    .bind(usuario_id.as_deref())
    .bind(sync_estado_inicial(usuario_id.as_deref()))
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let nota_venta_id = resultado.last_insert_rowid();

    insertar_detalles(&mut tx, nota_venta_id, &detalles).await?;
    registrar_catalogos_de_la_nota(&mut tx, usuario_id.as_deref(), &detalles).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(NotaVentaCreada {
        id: nota_venta_id,
        numero_nota,
    })
}

// Vista previa para el formulario de venta y para Ajustes. Usa la misma regla
// que crear_nota_venta para que el número que se ve sea el que se guarda.
#[tauri::command]
pub async fn obtener_siguiente_numero_nota(
    db_instances: State<'_, DbInstances>,
) -> Result<NumeracionNotas, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    calcular_numeracion(&mut conn).await
}

// La validación vive aquí y no solo en la pantalla: un folio igual o menor a
// la última nota se ignoraría en silencio (la numeración no retrocede) y el
// usuario creería que empezó en un número que nunca se usa.
//
// No pasa por configuracion::guardar_configuracion a propósito: esa guarda en
// el alcance de la sesión, y el folio es de la instalación.
#[tauri::command]
pub async fn guardar_folio_inicial(
    db_instances: State<'_, DbInstances>,
    valor: i64,
) -> Result<(), String> {
    if !(1..=FOLIO_MAXIMO).contains(&valor) {
        return Err(format!(
            "El número de nota debe ser un entero entre 1 y {FOLIO_MAXIMO}."
        ));
    }

    let pool = obtener_pool(db_instances.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let ultima: Option<i64> = sqlx::query_scalar("SELECT MAX(numero_nota) FROM notas_venta")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(ultima) = ultima {
        if valor <= ultima {
            return Err(format!(
                "No se puede usar la nota #{valor} como inicio: ya existe una nota con ese número o uno mayor. La última es la #{ultima}."
            ));
        }
    }

    // Con usuario_id NULL la PK compuesta no aplica (dos NULL no son iguales),
    // así que el ON CONFLICT nombra el índice parcial de la v4.
    sqlx::query(
        "INSERT INTO configuracion (usuario_id, clave, valor) VALUES (NULL, ?1, ?2)
         ON CONFLICT(clave) WHERE usuario_id IS NULL
         DO UPDATE SET valor = excluded.valor",
    )
    .bind(CLAVE_FOLIO_INICIAL)
    .bind(valor.to_string())
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
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
    estado: State<'_, EstadoSesion>,
    nota_venta_id: i64,
    nota: NotaVentaInput,
    mut detalles: Vec<DetalleVentaInput>,
) -> Result<(), String> {
    if detalles.is_empty() {
        return Err("La nota debe tener al menos una línea de detalle.".into());
    }
    normalizar_detalles(&mut detalles);

    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;
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
    registrar_catalogos_de_la_nota(&mut tx, usuario_id.as_deref(), &detalles).await?;

    // El UPDATE de arriba a propósito NO toca usuario_id: la nota conserva a
    // quien la capturó. Editarla desde otra sesión no le cambia el dueño, solo
    // la vuelve a poner en la cola de sincronización.
    marcar_pendiente(&mut *tx, TablaSync::NotasVenta, nota_venta_id).await?;

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