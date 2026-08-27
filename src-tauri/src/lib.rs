mod api;
mod auth;
mod catalogos;
mod clientes;
mod configuracion;
mod db;
mod migrations;
mod sincronizacion;
mod sync;
mod token;
mod ventas;

use auth::{
    adoptar_datos_locales, cerrar_sesion, contar_datos_locales, estado_conexion, iniciar_sesion,
    registrar_usuario, usuario_actual, EstadoSesion,
};
use token::EstadoToken;
use configuracion::{guardar_configuracion, leer_configuracion};
use sincronizacion::{contar_pendientes_sync, sincronizar_ahora};
use catalogos::{
    agregar_entrada_catalogo, contar_uso_en_ventas, eliminar_entrada_catalogo, leer_catalogo,
    renombrar_entrada_catalogo,
};
use clientes::{actualizar_cliente, crear_cliente, eliminar_cliente};
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
        // Sesión en memoria. Arranca vacía en cada ejecución; si había una
        // sesión recordada, se recupera de `configuracion` la primera vez que
        // alguien pregunte (ver auth::usuario_id_de_sesion). No se hace aquí
        // porque en el setup la base todavía no terminó de migrar.
        .manage(EstadoSesion::nueva())
        // El JWT vive aquí durante la corrida. No hay ningún comando que lo
        // devuelva: el token no cruza hacia JavaScript nunca.
        .manage(EstadoToken::nuevo())
        .setup(|app| {
            // NUEVO: se corre una vez al arrancar la app
            if let Err(e) = asegurar_carpeta_save(app.handle()) {
                eprintln!("Aviso: {e}");
            }

            // Recupera el JWT del llavero y comprueba contra el servidor si
            // sigue vigente. Va en una tarea aparte a propósito: implica una
            // petición HTTP y la ventana no tiene por qué esperarla. Si no hay
            // servidor, la app queda en modo local y todo funciona igual.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let instancias = handle.state::<tauri_plugin_sql::DbInstances>();
                let pool = match db::obtener_pool(instancias.inner()).await {
                    Ok(pool) => pool,
                    Err(e) => {
                        eprintln!("Aviso: no se pudo restaurar la sesión: {e}");
                        return;
                    }
                };
                if let Err(e) = auth::restaurar_token(
                    &pool,
                    &handle.state::<EstadoSesion>(),
                    &handle.state::<EstadoToken>(),
                )
                .await
                {
                    eprintln!("Aviso: no se pudo restaurar el token: {e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            crear_nota_venta,
            actualizar_nota_venta,
            eliminar_nota_venta,
            crear_cliente,
            actualizar_cliente,
            eliminar_cliente,
            agregar_entrada_catalogo,
            contar_uso_en_ventas,
            renombrar_entrada_catalogo,
            eliminar_entrada_catalogo,
            leer_catalogo,
            registrar_usuario,
            iniciar_sesion,
            cerrar_sesion,
            usuario_actual,
            contar_datos_locales,
            adoptar_datos_locales,
            estado_conexion,
            sincronizar_ahora,
            contar_pendientes_sync,
            leer_configuracion,
            guardar_configuracion
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}