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
use ventas::{actualizar_nota_venta, crear_nota_venta, eliminar_nota_venta};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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