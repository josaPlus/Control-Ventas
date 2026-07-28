use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migraciones() -> Vec<Migration> {
    vec![
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
        },
        // Aditiva a propósito: corre sobre bases que ya tienen ventas reales.
        // Nada de DROP ni de recrear tablas. La versión 1 no se toca nunca:
        // sqlx valida el checksum de las migraciones ya aplicadas y la app
        // no arrancaría en las instalaciones existentes.
        Migration {
            version: 2,
            description: "catalogos_de_hilo_y_configuracion",
            sql: "
                -- COLLATE NOCASE evita que 'Blanco' y 'blanco' entren como dos
                -- colores distintos. Ojo: SQLite solo pliega A-Z ASCII, así que
                -- 'CAFÉ' y 'Café' sí pasarían como distintos; eso se resuelve
                -- normalizando el texto antes de insertar.
                CREATE TABLE IF NOT EXISTS colores_hilo (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT NOT NULL COLLATE NOCASE UNIQUE
                );

                -- Se crea vacía: que el negocio maneje varios tipos de hilo es
                -- una decisión del usuario, no algo que se deduzca del catálogo.
                CREATE TABLE IF NOT EXISTS tipos_hilo (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT NOT NULL COLLATE NOCASE UNIQUE
                );

                CREATE TABLE IF NOT EXISTS configuracion (
                    clave TEXT PRIMARY KEY,
                    valor TEXT NOT NULL
                );

                -- Las líneas ya registradas quedan con tipo_hilo NULL, que es
                -- justo lo correcto: se vendieron sin esa dimensión.
                ALTER TABLE detalle_venta ADD COLUMN tipo_hilo TEXT;

                -- Los 12 colores que antes vivían hardcodeados en el frontend,
                -- para que el cliente actual no pierda sus sugerencias.
                INSERT OR IGNORE INTO colores_hilo (nombre) VALUES
                    ('Blanco'),
                    ('Negro'),
                    ('Crudo'),
                    ('Rojo'),
                    ('Azul rey'),
                    ('Azul marino'),
                    ('Verde'),
                    ('Amarillo'),
                    ('Rosa'),
                    ('Gris'),
                    ('Beige'),
                    ('Café');
            ",
            kind: MigrationKind::Up,
        },
    ]
}