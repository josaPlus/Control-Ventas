//! Envío de lo capturado en local hacia el servidor (push).
//!
//! Solo sube; no baja nada todavía. Traer del servidor lo que capturó otra PC
//! es un problema distinto (hay que decidir quién gana ante un conflicto) y no
//! entra aquí.
//!
//! Reglas que gobiernan todo el módulo:
//!
//! - **Solo con sesión remota.** Sin token no hay a qué cuenta colgar los
//!   datos, y sin login el usuario eligió quedarse local: eso se respeta.
//! - **Nada de lo local se borra ni se reescribe** más allá de rellenar el
//!   uuid que faltaba y marcar `sync_estado`. SQLite sigue siendo la copia
//!   buena mientras no exista el pull.
//! - **Idempotente.** Antes de mandar nada se lista lo que el servidor ya
//!   tiene y se compara por uuid (o por nombre en los catálogos, que no tienen
//!   uuid). Correr la sincronización dos veces no duplica nada.
//! - **Un fallo de red no es un error del usuario**: se corta la tanda, lo que
//!   ya subió queda marcado y el resto se reintenta la próxima vez.

use serde::Serialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use crate::api::{ApiAutenticada, ErrorApi};
use crate::auth::{usuario_id_de_sesion, EstadoSesion};
use crate::db::obtener_pool;
use crate::token::EstadoToken;

#[derive(Serialize, Debug, Default)]
pub struct ResumenSync {
    pub colores_hilo: u32,
    pub tipos_hilo: u32,
    pub clientes: u32,
    pub notas_venta: u32,
    /// Lo que el servidor rechazó, en palabras que se puedan enseñar. Que esto
    /// venga lleno no significa que la sincronización fallara: lo demás sí
    /// subió.
    pub problemas: Vec<String>,
}

/// Sube todo lo que esté pendiente. Devuelve cuánto se envió de cada cosa.
#[tauri::command]
pub async fn sincronizar_ahora(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    token_estado: State<'_, EstadoToken>,
) -> Result<ResumenSync, String> {
    let pool = obtener_pool(db_instances.inner()).await?;

    let usuario_id = usuario_id_de_sesion(&pool, estado.inner())
        .await?
        .ok_or("Necesitas iniciar sesión para enviar datos al servidor.")?;

    // El guard se copia y se suelta enseguida: es un Mutex de std y no puede
    // seguir tomado cruzando los await de la sincronización.
    let token = token_estado
        .lock()
        .map_err(|_| "Sesión corrupta.")?
        .clone()
        .ok_or(
            "Esta sesión no está conectada al servidor. Vuelve a iniciar sesión \
             con el servidor encendido.",
        )?;

    let url = crate::api::resolver_url(crate::auth::leer_api_url(&pool).await)
        .ok_or("Esta instalación no tiene servidor configurado.")?;

    let api = ApiAutenticada::nueva(&url, &token)
        .ok_or("No se pudo preparar la conexión con el servidor.")?;

    sincronizar(&pool, &api, &usuario_id).await
}

async fn sincronizar(
    pool: &sqlx::SqlitePool,
    api: &ApiAutenticada,
    usuario_id: &str,
) -> Result<ResumenSync, String> {
    let mut resumen = ResumenSync::default();

    // El orden importa: las notas referencian clientes por el id del SERVIDOR,
    // así que los clientes tienen que existir allá antes de mandar notas.
    subir_catalogo(pool, api, usuario_id, "colores_hilo", &mut resumen).await?;
    subir_catalogo(pool, api, usuario_id, "tipos_hilo", &mut resumen).await?;
    let mapa_clientes = subir_clientes(pool, api, usuario_id, &mut resumen).await?;
    subir_notas(pool, api, usuario_id, &mapa_clientes, &mut resumen).await?;

    Ok(resumen)
}

/// Traduce un error de la API a "corto la tanda" o "lo anoto y sigo".
///
/// Sin conexión se aborta: insistir con las 20 filas siguientes solo alarga la
/// espera. Un rechazo del servidor es de esa fila en particular, así que se
/// anota y las demás siguen su camino.
fn manejar(error: ErrorApi, contexto: &str, resumen: &mut ResumenSync) -> Result<(), String> {
    match error {
        ErrorApi::SinConexion => Err(
            "Se perdió la conexión con el servidor. Lo que alcanzó a subir quedó guardado; \
             el resto se enviará la próxima vez."
                .to_string(),
        ),
        ErrorApi::Rechazado(mensaje) => {
            resumen.problemas.push(format!("{contexto}: {mensaje}"));
            Ok(())
        }
    }
}

/// Catálogos: sin uuid, su identidad allá es (usuario_id, nombre). Se listan
/// primero y solo se manda lo que no esté.
async fn subir_catalogo(
    pool: &sqlx::SqlitePool,
    api: &ApiAutenticada,
    usuario_id: &str,
    tabla: &str,
    resumen: &mut ResumenSync,
) -> Result<(), String> {
    let remotos = match api.listar_catalogo(tabla).await {
        Ok(filas) => filas,
        Err(e) => return manejar(e, tabla, resumen),
    };
    // Comparación en minúsculas: el servidor tiene UNIQUE sobre el nombre y no
    // queremos mandar 'Blanco' cuando allá ya está 'blanco' y recibir un 409.
    let ya_estan: std::collections::HashSet<String> = remotos
        .into_iter()
        .map(|f| f.nombre.to_lowercase())
        .collect();

    let locales: Vec<(i64, String)> = sqlx::query_as(&format!(
        "SELECT id, nombre FROM {tabla} WHERE usuario_id = ?1 AND sync_estado <> 'sincronizado'"
    ))
    .bind(usuario_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    for (id, nombre) in locales {
        if !ya_estan.contains(&nombre.to_lowercase()) {
            if let Err(e) = api.crear_catalogo(tabla, &nombre).await {
                manejar(e, &format!("{tabla} «{nombre}»"), resumen)?;
                continue;
            }
            match tabla {
                "colores_hilo" => resumen.colores_hilo += 1,
                _ => resumen.tipos_hilo += 1,
            }
        }
        // Marcado también cuando ya existía allá: el objetivo es que deje de
        // aparecer como pendiente, y estar presente en el servidor es
        // exactamente eso.
        marcar_sincronizado(pool, tabla, id).await?;
    }

    Ok(())
}

/// Devuelve el mapa uuid_cliente -> id del servidor, que las notas necesitan
/// para poder apuntar a su cliente.
async fn subir_clientes(
    pool: &sqlx::SqlitePool,
    api: &ApiAutenticada,
    usuario_id: &str,
    resumen: &mut ResumenSync,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let remotos = match api.listar_clientes().await {
        Ok(filas) => filas,
        Err(e) => {
            manejar(e, "clientes", resumen)?;
            return Ok(Default::default());
        }
    };

    let mut por_uuid: std::collections::HashMap<String, i64> = remotos
        .into_iter()
        .filter_map(|f| f.uuid_cliente.map(|u| (u.to_lowercase(), f.id)))
        .collect();

    let locales: Vec<(i64, Option<String>, String, String, String)> = sqlx::query_as(
        "SELECT id, uuid_cliente, comprador, domicilio, telefono
           FROM clientes
          WHERE usuario_id = ?1 AND sync_estado <> 'sincronizado'
          ORDER BY id",
    )
    .bind(usuario_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    for (id, uuid, comprador, domicilio, telefono) in locales {
        // El uuid se rellena aquí, no en la migración: es justo el "relleno
        // perezoso" que la v3 dejó anotado. Antes de la primera sincronización
        // no hacía falta y habría sido ruido en la base.
        let uuid = asegurar_uuid(pool, "clientes", "uuid_cliente", id, uuid).await?;

        let cuerpo = serde_json::json!({
            "uuid_cliente": uuid,
            "comprador": comprador,
            "domicilio": domicilio,
            "telefono": telefono,
            "sync_estado": "sincronizado",
        });

        let resultado = match por_uuid.get(&uuid.to_lowercase()) {
            Some(&id_remoto) => api.actualizar_cliente(id_remoto, &cuerpo).await,
            None => api.crear_cliente(&cuerpo).await,
        };

        match resultado {
            Ok(fila) => {
                por_uuid.insert(uuid.to_lowercase(), fila.id);
                marcar_sincronizado(pool, "clientes", id).await?;
                resumen.clientes += 1;
            }
            Err(e) => manejar(e, &format!("cliente «{comprador}»"), resumen)?,
        }
    }

    Ok(por_uuid)
}

/// La nota tal como sale de SQLite. Como struct y no como tupla de nueve
/// campos: con tantos, un binding cruzado (fecha por tipo_deposito, los dos
/// TEXT) pasaría el compilador sin problema.
#[derive(sqlx::FromRow)]
struct NotaLocal {
    id: i64,
    #[sqlx(rename = "uuid_nota_venta")]
    uuid: Option<String>,
    numero_nota: i64,
    cliente_id: i64,
    fecha: String,
    tipo_deposito: String,
    pagado: i64,
    comentario: Option<String>,
    #[sqlx(rename = "total_venta")]
    total: f64,
}

/// Una línea de la nota. Mismo criterio que `NotaLocal`.
#[derive(sqlx::FromRow)]
struct DetalleLocal {
    #[sqlx(rename = "uuid_detalle_venta")]
    uuid: Option<String>,
    color_pina: String,
    cantidad_pinas: i64,
    precio_pina: f64,
    subtotal: f64,
    tipo_hilo: Option<String>,
}

async fn subir_notas(
    pool: &sqlx::SqlitePool,
    api: &ApiAutenticada,
    usuario_id: &str,
    mapa_clientes: &std::collections::HashMap<String, i64>,
    resumen: &mut ResumenSync,
) -> Result<(), String> {
    let remotas = match api.listar_notas().await {
        Ok(filas) => filas,
        Err(e) => return manejar(e, "notas de venta", resumen),
    };
    let por_uuid: std::collections::HashMap<String, i64> = remotas
        .into_iter()
        .filter_map(|f| f.uuid_nota_venta.map(|u| (u.to_lowercase(), f.id)))
        .collect();

    let locales: Vec<NotaLocal> = sqlx::query_as(
        "SELECT id, uuid_nota_venta, numero_nota, cliente_id, fecha,
                tipo_deposito, pagado, comentario, total_venta
           FROM notas_venta
          WHERE usuario_id = ?1 AND sync_estado <> 'sincronizado'
          ORDER BY id",
    )
    .bind(usuario_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    for nota in locales {
        let NotaLocal {
            id,
            uuid,
            numero_nota,
            cliente_id,
            fecha,
            tipo_deposito,
            pagado,
            comentario,
            total,
        } = nota;

        // El cliente_id local no sirve allá: el servidor tiene su propia
        // numeración. Se traduce por el uuid del cliente.
        let uuid_cliente: Option<String> =
            sqlx::query_scalar("SELECT uuid_cliente FROM clientes WHERE id = ?1")
                .bind(cliente_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?
                .flatten();

        let Some(id_cliente_remoto) = uuid_cliente
            .as_ref()
            .and_then(|u| mapa_clientes.get(&u.to_lowercase()))
            .copied()
        else {
            // Su cliente no llegó al servidor (falló arriba, o es de otro
            // usuario). Se salta sin marcarla: en la próxima tanda, ya con el
            // cliente arriba, sube sola.
            resumen.problemas.push(format!(
                "nota {numero_nota}: su cliente todavía no está en el servidor"
            ));
            continue;
        };

        let uuid = asegurar_uuid(pool, "notas_venta", "uuid_nota_venta", id, uuid).await?;
        let detalles = detalles_de(pool, id).await?;

        let cuerpo = serde_json::json!({
            "uuid_nota_venta": uuid,
            "numero_nota": numero_nota,
            "cliente_id": id_cliente_remoto,
            "fecha": fecha,
            "tipo_deposito": tipo_deposito,
            "pagado": pagado != 0,
            "comentario": comentario,
            "total_venta": total,
            "sync_estado": "sincronizado",
            "detalles": detalles,
        });

        let resultado = match por_uuid.get(&uuid.to_lowercase()) {
            Some(&id_remoto) => api.actualizar_nota(id_remoto, &cuerpo).await,
            None => api.crear_nota(&cuerpo).await,
        };

        match resultado {
            Ok(_) => {
                marcar_sincronizado(pool, "notas_venta", id).await?;
                resumen.notas_venta += 1;
            }
            Err(e) => manejar(e, &format!("nota {numero_nota}"), resumen)?,
        }
    }

    Ok(())
}

/// Las líneas viajan anidadas dentro de la nota: el servidor no las maneja por
/// separado y al actualizar reemplaza la lista completa.
async fn detalles_de(pool: &sqlx::SqlitePool, nota_id: i64) -> Result<serde_json::Value, String> {
    let filas: Vec<DetalleLocal> = sqlx::query_as(
        "SELECT uuid_detalle_venta, color_pina, cantidad_pinas, precio_pina, subtotal, tipo_hilo
           FROM detalle_venta WHERE nota_venta_id = ?1 ORDER BY id",
    )
    .bind(nota_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let detalles: Vec<serde_json::Value> = filas
        .into_iter()
        .map(|d| {
            serde_json::json!({
                // Si no tenía uuid se genera al vuelo y no se guarda: la línea
                // no tiene vida propia, siempre viaja con su nota y se
                // reemplaza entera al actualizar.
                "uuid_detalle_venta": d.uuid.unwrap_or_else(|| Uuid::new_v4().to_string()),
                "color_pina": d.color_pina,
                "cantidad_pinas": d.cantidad_pinas,
                "precio_pina": d.precio_pina,
                "subtotal": d.subtotal,
                "tipo_hilo": d.tipo_hilo,
            })
        })
        .collect();

    Ok(serde_json::Value::Array(detalles))
}

/// Devuelve el uuid de la fila, generándolo y guardándolo si estaba en NULL.
async fn asegurar_uuid(
    pool: &sqlx::SqlitePool,
    tabla: &str,
    columna: &str,
    id: i64,
    actual: Option<String>,
) -> Result<String, String> {
    if let Some(uuid) = actual {
        return Ok(uuid);
    }
    let nuevo = Uuid::new_v4().to_string();
    sqlx::query(&format!("UPDATE {tabla} SET {columna} = ?1 WHERE id = ?2"))
        .bind(&nuevo)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(nuevo)
}

async fn marcar_sincronizado(
    pool: &sqlx::SqlitePool,
    tabla: &str,
    id: i64,
) -> Result<(), String> {
    sqlx::query(&format!(
        "UPDATE {tabla} SET sync_estado = 'sincronizado' WHERE id = ?1"
    ))
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Cuánto falta por subir. Alimenta el botón de Ajustes para poder decir
/// "3 ventas por enviar" sin tocar la red.
#[derive(Serialize, Debug)]
pub struct PendientesSync {
    pub clientes: i64,
    pub notas_venta: i64,
    pub colores_hilo: i64,
    pub tipos_hilo: i64,
}

#[tauri::command]
pub async fn contar_pendientes_sync(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
) -> Result<PendientesSync, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let Some(usuario_id) = usuario_id_de_sesion(&pool, estado.inner()).await? else {
        // Sin sesión no hay nada que sincronizar: lo local es local.
        return Ok(PendientesSync {
            clientes: 0,
            notas_venta: 0,
            colores_hilo: 0,
            tipos_hilo: 0,
        });
    };

    async fn contar(pool: &sqlx::SqlitePool, tabla: &str, usuario: &str) -> Result<i64, String> {
        sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {tabla} WHERE usuario_id = ?1 AND sync_estado <> 'sincronizado'"
        ))
        .bind(usuario)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
    }

    Ok(PendientesSync {
        clientes: contar(&pool, "clientes", &usuario_id).await?,
        notas_venta: contar(&pool, "notas_venta", &usuario_id).await?,
        colores_hilo: contar(&pool, "colores_hilo", &usuario_id).await?,
        tipos_hilo: contar(&pool, "tipos_hilo", &usuario_id).await?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{ResultadoRegistro, ResultadoRemoto};

    const URL: &str = crate::api::API_URL_POR_DEFECTO;
    const PWD: &str = "hilo1234";

    async fn base_migrada() -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migracion in crate::migrations::migraciones() {
            sqlx::raw_sql(migracion.sql).execute(&pool).await.unwrap();
        }
        pool
    }

    /// Deja en SQLite un usuario con un cliente, una nota con dos líneas y un
    /// color de catálogo, todo pendiente. Es la foto de un vendedor que estuvo
    /// capturando y ahora se conecta.
    async fn sembrar(pool: &sqlx::SqlitePool, usuario_id: &str) {
        // La fila de usuarios primero: clientes.usuario_id es FK y SQLite la
        // hace cumplir. En el flujo real la crea el login remoto.
        sqlx::query(
            "INSERT OR IGNORE INTO usuarios (id_usuario, nombre_usuario, correo, password_hash)
             VALUES (?1, ?1, ?1 || '@correo.com', 'hash')",
        )
        .bind(usuario_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO clientes (id, comprador, domicilio, telefono, usuario_id, sync_estado)
             VALUES (1, 'Ana Pérez', 'Calle 1', '5551', ?1, 'pendiente')",
        )
        .bind(usuario_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO notas_venta
                (id, numero_nota, cliente_id, fecha, tipo_deposito, pagado, comentario,
                 total_venta, usuario_id, sync_estado)
             VALUES (1, 7, 1, '2026-08-20', 'Efectivo', 1, 'sin comentario', 270.0, ?1, 'pendiente')",
        )
        .bind(usuario_id)
        .execute(pool)
        .await
        .unwrap();

        for (color, cantidad, precio, subtotal) in
            [("Blanco", 3_i64, 50.0_f64, 150.0_f64), ("Azul rey", 2, 60.0, 120.0)]
        {
            sqlx::query(
                "INSERT INTO detalle_venta
                    (nota_venta_id, color_pina, cantidad_pinas, precio_pina, subtotal)
                 VALUES (1, ?1, ?2, ?3, ?4)",
            )
            .bind(color)
            .bind(cantidad)
            .bind(precio)
            .bind(subtotal)
            .execute(pool)
            .await
            .unwrap();
        }

        sqlx::query(
            "INSERT INTO colores_hilo (usuario_id, nombre, sync_estado)
             VALUES (?1, 'Turquesa', 'pendiente')",
        )
        .bind(usuario_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn contar_pendientes(pool: &sqlx::SqlitePool, tabla: &str) -> i64 {
        sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {tabla} WHERE sync_estado <> 'sincronizado'"
        ))
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Da de alta un usuario NUEVO en el servidor y devuelve (id_usuario, token).
    ///
    /// El sufijo aleatorio es lo que hace que estos tests se puedan correr
    /// muchas veces seguidas: sin él, la segunda corrida encontraría los datos
    /// que subió la primera y no tendría nada que sincronizar.
    async fn alta_y_login(prefijo: &str) -> (String, String) {
        let nombre = format!("{prefijo}_{}", &Uuid::new_v4().to_string()[..8]);
        let correo = format!("{nombre}@correo.com");

        match crate::api::registrar(URL, &nombre, &correo, PWD).await {
            ResultadoRegistro::Creado(_) => {}
            ResultadoRegistro::YaExiste(m) => panic!("el usuario debía ser nuevo: {m}"),
            ResultadoRegistro::NoDisponible => panic!("el backend no responde"),
        }
        match crate::api::login(URL, &nombre, PWD).await {
            ResultadoRemoto::Autenticado { token, usuario } => (usuario.id_usuario, token),
            otro => panic!("no se pudo entrar: {otro:?}"),
        }
    }

    #[tokio::test]
    #[ignore = "necesita el backend en 127.0.0.1:8000"]
    async fn sube_todo_lo_pendiente_y_lo_marca() {
        let pool = base_migrada().await;
        let (usuario_id, token) = alta_y_login("sync_demo_1").await;
        sembrar(&pool, &usuario_id).await;

        let api = ApiAutenticada::nueva(URL, &token).unwrap();
        let resumen = sincronizar(&pool, &api, &usuario_id).await.unwrap();

        assert!(resumen.problemas.is_empty(), "hubo problemas: {:?}", resumen.problemas);
        assert_eq!(resumen.clientes, 1);
        assert_eq!(resumen.notas_venta, 1);
        assert_eq!(resumen.colores_hilo, 1, "solo 'Turquesa' es del usuario");

        // Ya nada queda pendiente en local.
        assert_eq!(contar_pendientes(&pool, "clientes").await, 0);
        assert_eq!(contar_pendientes(&pool, "notas_venta").await, 0);

        // Y los uuid que la v3 dejó en NULL se rellenaron al subir.
        let uuid_cliente: Option<String> =
            sqlx::query_scalar("SELECT uuid_cliente FROM clientes WHERE id = 1")
                .fetch_one(&pool).await.unwrap();
        assert!(uuid_cliente.is_some(), "el uuid del cliente sigue en NULL");
    }

    // Lo más importante de todo: correr la sincronización dos veces no debe
    // duplicar nada en el servidor.
    #[tokio::test]
    #[ignore = "necesita el backend en 127.0.0.1:8000"]
    async fn sincronizar_dos_veces_no_duplica() {
        let pool = base_migrada().await;
        let (usuario_id, token) = alta_y_login("sync_demo_2").await;
        sembrar(&pool, &usuario_id).await;

        let api = ApiAutenticada::nueva(URL, &token).unwrap();
        sincronizar(&pool, &api, &usuario_id).await.unwrap();

        // Se fuerza a que todo vuelva a estar pendiente, como si se hubiera
        // editado: el servidor debe ACTUALIZAR, no crear otra copia.
        for tabla in ["clientes", "notas_venta", "colores_hilo"] {
            sqlx::query(&format!("UPDATE {tabla} SET sync_estado = 'pendiente'"))
                .execute(&pool).await.unwrap();
        }
        let segundo = sincronizar(&pool, &api, &usuario_id).await.unwrap();
        assert!(segundo.problemas.is_empty(), "{:?}", segundo.problemas);

        assert_eq!(api.listar_clientes().await.unwrap().len(), 1, "el cliente se duplicó");
        assert_eq!(api.listar_notas().await.unwrap().len(), 1, "la nota se duplicó");
        // El color ya estaba allá, así que no se vuelve a mandar.
        assert_eq!(segundo.colores_hilo, 0);
        assert_eq!(api.listar_catalogo("colores_hilo").await.unwrap().len(), 1);
    }

    // Cada quien sube lo suyo: el servidor acota por token y la consulta local
    // acota por usuario_id.
    #[tokio::test]
    #[ignore = "necesita el backend en 127.0.0.1:8000"]
    async fn no_se_sube_lo_de_otro_usuario() {
        let pool = base_migrada().await;
        let (uno, token) = alta_y_login("sync_demo_3").await;
        let (dos, _) = alta_y_login("sync_demo_4").await;

        sembrar(&pool, &uno).await;

        // El segundo usuario también necesita su fila local: usuario_id es FK.
        sqlx::query(
            "INSERT OR IGNORE INTO usuarios (id_usuario, nombre_usuario, correo, password_hash)
             VALUES (?1, ?1, ?1 || '@correo.com', 'hash')",
        )
        .bind(&dos).execute(&pool).await.unwrap();

        // Un cliente del otro usuario y uno sin dueño (modo 100% local).
        sqlx::query("INSERT INTO clientes (comprador,domicilio,telefono,usuario_id,sync_estado) VALUES ('De otro','x','y',?1,'pendiente')")
            .bind(&dos).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO clientes (comprador,domicilio,telefono,usuario_id,sync_estado) VALUES ('Local','x','y',NULL,'local')")
            .execute(&pool).await.unwrap();

        let api = ApiAutenticada::nueva(URL, &token).unwrap();
        let resumen = sincronizar(&pool, &api, &uno).await.unwrap();

        assert_eq!(resumen.clientes, 1, "solo debía subir el suyo");
        assert_eq!(api.listar_clientes().await.unwrap().len(), 1);

        // El cliente sin dueño sigue intacto y sin subir: modo local es
        // permanente y la sincronización no lo toca.
        let local: String = sqlx::query_scalar(
            "SELECT sync_estado FROM clientes WHERE comprador = 'Local'",
        )
        .fetch_one(&pool).await.unwrap();
        assert_eq!(local, "local");
    }

    #[tokio::test]
    async fn sin_servidor_la_sincronizacion_avisa_sin_romper_nada() {
        let pool = base_migrada().await;
        sembrar(&pool, "u-inventado").await;

        // Puerto muerto: nadie escuchando.
        let api = ApiAutenticada::nueva("http://127.0.0.1:1", "token").unwrap();
        let resultado = sincronizar(&pool, &api, "u-inventado").await;

        assert!(resultado.is_err(), "debería avisar que se perdió la conexión");
        // Y lo local queda exactamente como estaba, listo para reintentar.
        assert_eq!(contar_pendientes(&pool, "clientes").await, 1);
        assert_eq!(contar_pendientes(&pool, "notas_venta").await, 1);
    }
}
