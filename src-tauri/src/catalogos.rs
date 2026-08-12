use serde::Deserialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::auth::{sync_estado_inicial, usuario_id_de_sesion, EstadoSesion};
use crate::db::obtener_pool;

// ============================================
// CATÁLOGOS DE HILO
// ============================================

// El nombre de tabla no se puede pasar como parámetro bindeable en SQL, hay que
// interpolarlo. Este enum es la lista blanca: nunca llega texto arbitrario del
// frontend a una consulta.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Catalogo {
    ColoresHilo,
    TiposHilo,
}

impl Catalogo {
    pub fn tabla(self) -> &'static str {
        match self {
            Catalogo::ColoresHilo => "colores_hilo",
            Catalogo::TiposHilo => "tipos_hilo",
        }
    }

    /// Columna de `detalle_venta` alimentada por este catálogo. Se usa para
    /// propagar un renombre a las ventas ya registradas.
    pub fn columna_detalle(self) -> &'static str {
        match self {
            Catalogo::ColoresHilo => "color_pina",
            Catalogo::TiposHilo => "tipo_hilo",
        }
    }

    /// La misma tabla, vista desde la lista blanca de sincronización.
    pub fn tabla_sync(self) -> crate::sync::TablaSync {
        match self {
            Catalogo::ColoresHilo => crate::sync::TablaSync::ColoresHilo,
            Catalogo::TiposHilo => crate::sync::TablaSync::TiposHilo,
        }
    }
}

/// Deja el nombre en una forma canónica: sin espacios sobrantes y con la
/// primera letra en mayúscula.
///
/// El UNIQUE COLLATE NOCASE de SQLite solo pliega A-Z ASCII, así que sin esto
/// "CAFÉ" y "Café" entrarían al catálogo como dos colores distintos. Normalizar
/// con las funciones Unicode de Rust hace que ambos converjan a "Café".
///
/// Se aplica también al valor que se guarda en la venta, no solo al del
/// catálogo: si difirieran, las gráficas por color partirían un mismo color
/// en varios.
pub fn normalizar_nombre(valor: &str) -> String {
    // split_whitespace + join colapsa de paso los espacios internos dobles.
    let limpio = valor.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut caracteres = limpio.chars();
    match caracteres.next() {
        None => String::new(),
        Some(primera) => {
            primera.to_uppercase().collect::<String>() + &caracteres.as_str().to_lowercase()
        }
    }
}

/// Da de alta los valores que aún no existan. Genérica para los dos catálogos:
/// lo único que cambia entre ellos es la tabla.
///
/// Desde la v4 el catálogo es por usuario: `usuario_id = None` es el catálogo
/// local de la PC sin login, y es un alcance legítimo y permanente, no un
/// estado de transición. El INSERT OR IGNORE se apoya en los índices únicos de
/// la v4 (el compuesto para usuario real, el parcial para el caso NULL).
pub async fn registrar_en_catalogo(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    catalogo: Catalogo,
    usuario_id: Option<&str>,
    valores: impl IntoIterator<Item = String>,
) -> Result<(), String> {
    let sql = format!(
        "INSERT OR IGNORE INTO {} (usuario_id, nombre, sync_estado) VALUES (?1, ?2, ?3)",
        catalogo.tabla()
    );
    for valor in valores {
        if valor.is_empty() {
            continue;
        }
        sqlx::query(&sql)
            .bind(usuario_id)
            .bind(&valor)
            .bind(sync_estado_inicial(usuario_id))
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Las entradas visibles para quien esté operando ahora.
///
/// `usuario_id IS ?1` en vez de `=`: el operador IS de SQLite sí compara NULL
/// con NULL, así que el mismo binding sirve para la sesión activa y para el
/// modo sin login. Con `=` la consulta no devolvería nada al no haber sesión.
#[tauri::command]
pub async fn leer_catalogo(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    catalogo: Catalogo,
) -> Result<Vec<String>, String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;

    sqlx::query_scalar::<_, String>(&format!(
        "SELECT nombre FROM {} WHERE usuario_id IS ?1
          ORDER BY nombre COLLATE NOCASE ASC",
        catalogo.tabla()
    ))
    .bind(usuario_id.as_deref())
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

/// Da de alta una entrada a mano, desde el formulario de venta o desde Ajustes.
///
/// Devuelve el nombre ya normalizado para que la interfaz seleccione la forma
/// canónica y no la que se escribió. Si el valor ya existía no es un error:
/// simplemente se devuelve, que es lo que el usuario quería seleccionar.
#[tauri::command]
pub async fn agregar_entrada_catalogo(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    catalogo: Catalogo,
    nombre: String,
) -> Result<String, String> {
    let normalizado = normalizar_nombre(&nombre);
    if normalizado.is_empty() {
        return Err("El nombre no puede estar vacío.".into());
    }

    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    registrar_en_catalogo(&mut tx, catalogo, usuario_id.as_deref(), [normalizado.clone()]).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(normalizado)
}

/// Cuántas líneas de venta usan este valor. Sirve para avisar al usuario antes
/// de que borre una entrada del catálogo.
#[tauri::command]
pub async fn contar_uso_en_ventas(
    db_instances: State<'_, DbInstances>,
    catalogo: Catalogo,
    nombre: String,
) -> Result<i64, String> {
    let pool = obtener_pool(db_instances.inner()).await?;

    let sql = format!(
        "SELECT COUNT(*) FROM detalle_venta WHERE {} = ?1",
        catalogo.columna_detalle()
    );
    sqlx::query_scalar(&sql)
        .bind(normalizar_nombre(&nombre))
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())
}

/// Renombra una entrada del catálogo Y las ventas que la usan.
///
/// `color_pina` y `tipo_hilo` son texto libre en `detalle_venta`, no llaves
/// foráneas. Si solo se cambiara el catálogo, las ventas viejas conservarían el
/// nombre mal escrito y el Panel seguiría mostrándolo como algo aparte.
///
/// Si el nombre nuevo ya existe en el catálogo, las dos entradas se fusionan:
/// es el caso típico de corregir un "Azul rye" hacia el "Azul rey" que ya está.
///
/// Devuelve cuántas líneas de venta se actualizaron.
#[tauri::command]
pub async fn renombrar_entrada_catalogo(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    catalogo: Catalogo,
    nombre_actual: String,
    nombre_nuevo: String,
) -> Result<u64, String> {
    let actual = normalizar_nombre(&nombre_actual);
    let nuevo = normalizar_nombre(&nombre_nuevo);

    if nuevo.is_empty() {
        return Err("El nombre no puede quedar vacío.".into());
    }
    if actual == nuevo {
        return Ok(0);
    }

    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tabla = catalogo.tabla();

    // Todas las consultas van acotadas al usuario de la sesión: renombrar en el
    // catálogo propio no debe tocar el de otro usuario ni el local.
    let ya_existe: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM {tabla} WHERE nombre = ?1 AND usuario_id IS ?2"
    ))
    .bind(&nuevo)
    .bind(usuario_id.as_deref())
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if ya_existe > 0 {
        // Fusión: sobra la entrada vieja, el destino ya está en el catálogo.
        sqlx::query(&format!(
            "DELETE FROM {tabla} WHERE nombre = ?1 AND usuario_id IS ?2"
        ))
        .bind(&actual)
        .bind(usuario_id.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        let id_renombrado: Option<i64> = sqlx::query_scalar(&format!(
            "SELECT id FROM {tabla} WHERE nombre = ?1 AND usuario_id IS ?2"
        ))
        .bind(&actual)
        .bind(usuario_id.as_deref())
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let Some(id_renombrado) = id_renombrado else {
            return Err(format!("\"{actual}\" ya no está en el catálogo."));
        };

        sqlx::query(&format!("UPDATE {tabla} SET nombre = ?1 WHERE id = ?2"))
            .bind(&nuevo)
            .bind(id_renombrado)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        // Edición real disparada por el usuario: entra a la cola de sync.
        crate::sync::marcar_pendiente(&mut *tx, catalogo.tabla_sync(), id_renombrado).await?;
    }

    let lineas = sqlx::query(&format!(
        "UPDATE detalle_venta SET {} = ?1 WHERE {} = ?2",
        catalogo.columna_detalle(),
        catalogo.columna_detalle()
    ))
    .bind(&nuevo)
    .bind(&actual)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(lineas.rows_affected())
}

/// Quita una entrada del catálogo. No toca las ventas: como no hay llave
/// foránea, el historial conserva su texto y solo deja de sugerirse.
#[tauri::command]
pub async fn eliminar_entrada_catalogo(
    db_instances: State<'_, DbInstances>,
    estado: State<'_, EstadoSesion>,
    catalogo: Catalogo,
    nombre: String,
) -> Result<(), String> {
    let pool = obtener_pool(db_instances.inner()).await?;
    let usuario_id = usuario_id_de_sesion(&pool, estado.inner()).await?;

    let resultado = sqlx::query(&format!(
        "DELETE FROM {} WHERE nombre = ?1 AND usuario_id IS ?2",
        catalogo.tabla()
    ))
    .bind(normalizar_nombre(&nombre))
    .bind(usuario_id.as_deref())
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if resultado.rows_affected() == 0 {
        return Err("Esa entrada ya no está en el catálogo.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::normalizar_nombre;

    async fn base_migrada() -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migracion in crate::migrations::migraciones() {
            sqlx::raw_sql(migracion.sql).execute(&pool).await.unwrap();
        }
        pool
    }

    async fn registrar(pool: &sqlx::SqlitePool, usuario_id: Option<&str>, nombre: &str) {
        let mut tx = pool.begin().await.unwrap();
        registrar_en_catalogo(&mut tx, Catalogo::ColoresHilo, usuario_id, [nombre.to_string()])
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }

    async fn colores_de(pool: &sqlx::SqlitePool, usuario_id: Option<&str>) -> Vec<String> {
        sqlx::query_scalar::<_, String>(
            "SELECT nombre FROM colores_hilo WHERE usuario_id IS ?1 ORDER BY nombre",
        )
        .bind(usuario_id)
        .fetch_all(pool)
        .await
        .unwrap()
    }

    // Este es el caso de las dos PCs en producción: sin login, todo cae en
    // usuario_id NULL. Como en SQLite dos NULL no son iguales entre sí, el
    // índice único compuesto no alcanza — lo que sostiene el INSERT OR IGNORE
    // es el índice parcial de la v4.
    #[tokio::test]
    async fn sin_sesion_el_catalogo_no_acumula_duplicados() {
        let pool = base_migrada().await;
        for _ in 0..3 {
            registrar(&pool, None, "Turquesa").await;
        }
        let repetidos: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM colores_hilo WHERE nombre = 'Turquesa' AND usuario_id IS NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(repetidos, 1, "el catálogo local acumuló duplicados");
    }

    // Un usuario con login y el catálogo local (sin login) pueden tener el
    // mismo color sin chocar: son alcances distintos.
    #[tokio::test]
    async fn el_mismo_color_convive_en_dos_alcances() {
        let pool = base_migrada().await;
        sqlx::query(
            "INSERT INTO usuarios (id_usuario, nombre_usuario, correo, password_hash)
             VALUES ('u1','Josafat','josafat@correo.com','x')",
        )
        .execute(&pool)
        .await
        .unwrap();

        registrar(&pool, None, "Blanco").await; // ya venía sembrado en la v2
        registrar(&pool, Some("u1"), "Blanco").await;

        assert!(colores_de(&pool, None).await.contains(&"Blanco".to_string()));
        assert_eq!(colores_de(&pool, Some("u1")).await, vec!["Blanco"]);
    }

    // Cada quien ve lo suyo: el catálogo del usuario logueado no arrastra los
    // colores locales, ni al revés.
    #[tokio::test]
    async fn cada_alcance_lee_solo_lo_propio() {
        let pool = base_migrada().await;
        sqlx::query(
            "INSERT INTO usuarios (id_usuario, nombre_usuario, correo, password_hash)
             VALUES ('u1','Josafat','josafat@correo.com','x')",
        )
        .execute(&pool)
        .await
        .unwrap();

        registrar(&pool, Some("u1"), "Turquesa").await;

        assert!(!colores_de(&pool, None).await.contains(&"Turquesa".to_string()));
        assert_eq!(colores_de(&pool, Some("u1")).await, vec!["Turquesa"]);
    }

    // Sin sesión la fila nace 'local' y marcar_pendiente no debe moverla: no
    // hay servidor al cual mandarla.
    #[tokio::test]
    async fn una_fila_sin_usuario_nunca_queda_pendiente() {
        let pool = base_migrada().await;
        registrar(&pool, None, "Turquesa").await;

        let id: i64 = sqlx::query_scalar("SELECT id FROM colores_hilo WHERE nombre = 'Turquesa'")
            .fetch_one(&pool)
            .await
            .unwrap();
        crate::sync::marcar_pendiente(&pool, crate::sync::TablaSync::ColoresHilo, id)
            .await
            .unwrap();

        let estado: String =
            sqlx::query_scalar("SELECT sync_estado FROM colores_hilo WHERE id = ?1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(estado, "local");
    }

    #[tokio::test]
    async fn con_sesion_la_fila_nace_pendiente() {
        let pool = base_migrada().await;
        sqlx::query(
            "INSERT INTO usuarios (id_usuario, nombre_usuario, correo, password_hash)
             VALUES ('u1','Josafat','josafat@correo.com','x')",
        )
        .execute(&pool)
        .await
        .unwrap();
        registrar(&pool, Some("u1"), "Turquesa").await;

        let estado: String = sqlx::query_scalar(
            "SELECT sync_estado FROM colores_hilo WHERE nombre = 'Turquesa' AND usuario_id = 'u1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(estado, "pendiente");
    }

    #[test]
    fn recorta_y_colapsa_espacios() {
        assert_eq!(normalizar_nombre("  Blanco  "), "Blanco");
        assert_eq!(normalizar_nombre("Azul   rey"), "Azul rey");
        assert_eq!(normalizar_nombre("   "), "");
        assert_eq!(normalizar_nombre(""), "");
    }

    #[test]
    fn unifica_mayusculas_ascii() {
        assert_eq!(normalizar_nombre("blanco"), "Blanco");
        assert_eq!(normalizar_nombre("BLANCO"), "Blanco");
        assert_eq!(normalizar_nombre("AZUL REY"), "Azul rey");
    }

    // Este es el caso que COLLATE NOCASE de SQLite no cubre: solo pliega A-Z.
    #[test]
    fn unifica_mayusculas_con_acento() {
        assert_eq!(normalizar_nombre("CAFÉ"), "Café");
        assert_eq!(normalizar_nombre("café"), "Café");
        assert_eq!(normalizar_nombre("AÑIL"), "Añil");
        assert_eq!(normalizar_nombre("MARRÓN"), "Marrón");
    }

    // Un acento en la PRIMERA letra: to_uppercase debe respetarlo.
    #[test]
    fn respeta_acento_inicial() {
        assert_eq!(normalizar_nombre("ámbar"), "Ámbar");
        assert_eq!(normalizar_nombre("ÁMBAR"), "Ámbar");
    }

    // Los 12 colores sembrados en la migración v2 ya deben estar en forma
    // canónica: si no, el INSERT OR IGNORE crearía duplicados al primer uso.
    #[test]
    fn los_colores_sembrados_ya_estan_normalizados() {
        for color in [
            "Blanco",
            "Negro",
            "Crudo",
            "Rojo",
            "Azul rey",
            "Azul marino",
            "Verde",
            "Amarillo",
            "Rosa",
            "Gris",
            "Beige",
            "Café",
        ] {
            assert_eq!(normalizar_nombre(color), color, "«{color}» no es canónico");
        }
    }
}