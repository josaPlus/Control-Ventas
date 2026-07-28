use serde::Deserialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

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
pub async fn registrar_en_catalogo(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    catalogo: Catalogo,
    valores: impl IntoIterator<Item = String>,
) -> Result<(), String> {
    let sql = format!(
        "INSERT OR IGNORE INTO {} (nombre) VALUES (?1)",
        catalogo.tabla()
    );
    for valor in valores {
        if valor.is_empty() {
            continue;
        }
        sqlx::query(&sql)
            .bind(&valor)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Da de alta una entrada a mano, desde el formulario de venta o desde Ajustes.
///
/// Devuelve el nombre ya normalizado para que la interfaz seleccione la forma
/// canónica y no la que se escribió. Si el valor ya existía no es un error:
/// simplemente se devuelve, que es lo que el usuario quería seleccionar.
#[tauri::command]
pub async fn agregar_entrada_catalogo(
    db_instances: State<'_, DbInstances>,
    catalogo: Catalogo,
    nombre: String,
) -> Result<String, String> {
    let normalizado = normalizar_nombre(&nombre);
    if normalizado.is_empty() {
        return Err("El nombre no puede estar vacío.".into());
    }

    let pool = obtener_pool(db_instances.inner()).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    registrar_en_catalogo(&mut tx, catalogo, [normalizado.clone()]).await?;

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
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tabla = catalogo.tabla();

    let ya_existe: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM {tabla} WHERE nombre = ?1"
    ))
    .bind(&nuevo)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if ya_existe > 0 {
        // Fusión: sobra la entrada vieja, el destino ya está en el catálogo.
        sqlx::query(&format!("DELETE FROM {tabla} WHERE nombre = ?1"))
            .bind(&actual)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        let renombrada = sqlx::query(&format!("UPDATE {tabla} SET nombre = ?1 WHERE nombre = ?2"))
            .bind(&nuevo)
            .bind(&actual)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        if renombrada.rows_affected() == 0 {
            return Err(format!("\"{actual}\" ya no está en el catálogo."));
        }
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
    catalogo: Catalogo,
    nombre: String,
) -> Result<(), String> {
    let pool = obtener_pool(db_instances.inner()).await?;

    let resultado = sqlx::query(&format!(
        "DELETE FROM {} WHERE nombre = ?1",
        catalogo.tabla()
    ))
    .bind(normalizar_nombre(&nombre))
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
    use super::normalizar_nombre;

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