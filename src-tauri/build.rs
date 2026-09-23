fn main() {
    exportar_api_url_por_defecto();
    exportar_db_url();
    tauri_build::build()
}

/// Dirección por defecto del servidor. Sale de `.env` (o de una variable de
/// entorno con el mismo nombre, que gana) y llega al código vía `env!`.
///
/// Sin valor, el build falla a propósito: compilar en silencio con un servidor
/// vacío dejaría el login remoto apagado en todas las PCs sin avisar.
fn exportar_api_url_por_defecto() {
    const CLAVE: &str = "CONTROL_VENTAS_API_URL_POR_DEFECTO";
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-env-changed={CLAVE}");

    let valor = std::env::var(CLAVE).ok().or_else(|| {
        std::fs::read_to_string(".env").ok()?.lines().find_map(|linea| {
            let (clave, valor) = linea.split_once('=')?;
            (clave.trim() == CLAVE).then(|| valor.trim().to_string())
        })
    });

    match valor {
        Some(url) if !url.is_empty() => println!("cargo:rustc-env={CLAVE}={url}"),
        _ => panic!("Falta {CLAVE}: defínelo en src-tauri/.env o como variable de entorno."),
    }
}

/// Nombre de la base. La única fuente es `plugins.sql.preload` de
/// tauri.conf.json: Tauri necesita el valor ahí para abrirla al arrancar, y
/// las migraciones tienen que registrarse contra exactamente la misma cadena.
fn exportar_db_url() {
    println!("cargo:rerun-if-changed=tauri.conf.json");

    let texto = std::fs::read_to_string("tauri.conf.json").expect("No se pudo leer tauri.conf.json");
    let conf: serde_json::Value =
        serde_json::from_str(&texto).expect("tauri.conf.json no es JSON válido");
    let db_url = conf["plugins"]["sql"]["preload"][0]
        .as_str()
        .expect("tauri.conf.json debe tener plugins.sql.preload[0]");

    println!("cargo:rustc-env=CONTROL_VENTAS_DB_URL={db_url}");
}
