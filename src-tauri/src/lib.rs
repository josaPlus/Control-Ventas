use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "crear_tablas_iniciales",
            sql: "
                CREATE TABLE clientes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    comprador TEXT NOT NULL,
                    domicilio TEXT NOT NULL,
                    telefono TEXT NOT NULL
                );

                CREATE TABLE notas_venta (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero_nota INTEGER NOT NULL,
                    cliente_id INTEGER NOT NULL,
                    fecha TEXT NOT NULL,
                    tipo_deposito TEXT NOT NULL,
                    pagado INTEGER NOT NULL DEFAULT 0,
                    comentario TEXT,
                    total_venta REAL NOT NULL DEFAULT 0,
                    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
                );

                CREATE TABLE detalle_venta (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nota_venta_id INTEGER NOT NULL,
                    color_pina TEXT NOT NULL,
                    cantidad_pinas INTEGER NOT NULL,
                    precio_pina REAL NOT NULL,
                    subtotal REAL NOT NULL,
                    FOREIGN KEY (nota_venta_id) REFERENCES notas_venta(id)
                );
            ",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ventas.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}