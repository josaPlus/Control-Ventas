mod catalogos;
mod clientes;
mod db;
mod migrations;
mod ventas;

use catalogos::{
    agregar_entrada_catalogo, contar_uso_en_ventas, eliminar_entrada_catalogo,
    renombrar_entrada_catalogo,
};
use clientes::eliminar_cliente;
use tauri::Manager; // NUEVO: necesario para app.path()
use ventas::{actualizar_nota_venta, crear_nota_venta, eliminar_nota_venta};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// NUEVO: crea Documentos/Control de Ventas/Save si no existe.
// create_dir_all no truena si la carpeta ya está ahí, así que es seguro
// llamarla en cada arranque de la app.
fn asegurar_carpeta_save(app: &tauri::AppHandle) -> Result<(), String> {
    let documentos = app
        .path()
        .document_dir()
        .map_err(|e| format!("No se pudo resolver la carpeta de Documentos: {e}"))?;

    let carpeta_save = documentos.join("Control de Ventas").join("Save");

    std::fs::create_dir_all(&carpeta_save)
        .map_err(|e| format!("No se pudo crear la carpeta Save: {e}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, migrations::migraciones())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init()) // NUEVO
        .plugin(tauri_plugin_dialog::init()) // NUEVO
        .setup(|app| {
            // NUEVO: se corre una vez al arrancar la app
            if let Err(e) = asegurar_carpeta_save(app.handle()) {
                eprintln!("Aviso: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            crear_nota_venta,
            actualizar_nota_venta,
            eliminar_nota_venta,
            eliminar_cliente,
            agregar_entrada_catalogo,
            contar_uso_en_ventas,
            renombrar_entrada_catalogo,
            eliminar_entrada_catalogo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}