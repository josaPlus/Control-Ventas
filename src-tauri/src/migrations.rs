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
        // Igual que la v2: corre sobre bases con ventas reales, así que todo es
        // aditivo. Ninguna tabla existente se reconstruye aquí.
        Migration {
            version: 3,
            description: "sincronizacion_uuid_y_usuarios",
            sql: "
                -- Los id INTEGER AUTOINCREMENT no se tocan: siguen siendo la
                -- llave local. El UUID es una identidad ADICIONAL, pensada para
                -- el servidor central que todavía no existe, y se rellena de
                -- forma perezosa (la primera vez que la fila se sincronice),
                -- no durante la migración. Por eso entran en NULL.
                --
                -- OJO: SQLite no permite 'ADD COLUMN ... UNIQUE' — devuelve
                -- 'Cannot add a UNIQUE column' y la migración entera falla, con
                -- lo que la app no arranca. La unicidad se aplica con un índice
                -- aparte, que es equivalente. Como los NULL no se comparan
                -- entre sí, todas las filas conviven sin chocar.
                ALTER TABLE clientes ADD COLUMN uuid_cliente TEXT;
                ALTER TABLE notas_venta ADD COLUMN uuid_nota_venta TEXT;
                ALTER TABLE detalle_venta ADD COLUMN uuid_detalle_venta TEXT;

                CREATE UNIQUE INDEX idx_clientes_uuid ON clientes(uuid_cliente);
                CREATE UNIQUE INDEX idx_notas_venta_uuid ON notas_venta(uuid_nota_venta);
                CREATE UNIQUE INDEX idx_detalle_venta_uuid ON detalle_venta(uuid_detalle_venta);

                -- Hoy es la fuente de verdad: no hay servidor contra el cual
                -- validar, el login es 100% local. Cuando exista el servidor,
                -- esta misma tabla pasa a ser cache y se refresca en cada
                -- login con conexión; la forma no cambia.
                --
                -- correo va COLLATE NOCASE igual que nombre_usuario: se puede
                -- iniciar sesión con cualquiera de los dos, y nadie escribe su
                -- correo con las mismas mayúsculas cada vez.
                --
                -- rol tiene DEFAULT 'vendedor' aunque nada lo use todavía:
                -- evita otra migración el día que haga falta distinguir roles
                -- (mismo criterio que tipo_hilo en v2).
                CREATE TABLE usuarios (
                    id_usuario TEXT PRIMARY KEY,
                    nombre_usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    correo TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_hash TEXT NOT NULL,
                    rol TEXT NOT NULL DEFAULT 'vendedor',
                    ultima_sincronizacion TEXT
                );

                -- usuario_id es NULLABLE de forma PERMANENTE, no transitoria:
                -- iniciar sesión es opcional y lo va a seguir siendo para la PC
                -- que se quede 100% local. Sin login, la fila queda con
                -- usuario_id NULL y nunca se envía a ningún lado.
                ALTER TABLE clientes ADD COLUMN usuario_id TEXT REFERENCES usuarios(id_usuario);
                ALTER TABLE notas_venta ADD COLUMN usuario_id TEXT REFERENCES usuarios(id_usuario);

                -- 'local' (sin login, nunca sincroniza) | 'pendiente' | 'sincronizado'.
                ALTER TABLE clientes ADD COLUMN sync_estado TEXT NOT NULL DEFAULT 'local';
                ALTER TABLE notas_venta ADD COLUMN sync_estado TEXT NOT NULL DEFAULT 'local';
                ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "catalogos_y_configuracion_por_usuario",
            sql: "
                -- Estas tres tablas eran globales a la base. Ahora su alcance es
                -- por usuario: dos vendedores pueden manejar paletas y ajustes
                -- distintos sin pisarse.
                --
                -- SQLite no sabe hacer ALTER de una restricción UNIQUE, así que
                -- la única vía es reconstruir: crear la nueva, copiar, borrar la
                -- vieja, renombrar. Los datos copiados van con usuario_id = NULL
                -- a propósito: son catálogos anteriores al login y siguen siendo
                -- el catálogo local válido de esa PC.
                CREATE TABLE colores_hilo_new (
                    id INTEGER PRIMARY KEY,
                    usuario_id TEXT REFERENCES usuarios(id_usuario),
                    nombre TEXT NOT NULL COLLATE NOCASE,
                    sync_estado TEXT NOT NULL DEFAULT 'local'
                );
                INSERT INTO colores_hilo_new (id, usuario_id, nombre, sync_estado)
                SELECT id, NULL, nombre, 'local' FROM colores_hilo;
                DROP TABLE colores_hilo;
                ALTER TABLE colores_hilo_new RENAME TO colores_hilo;
                CREATE UNIQUE INDEX idx_colores_hilo_usuario_nombre
                    ON colores_hilo(usuario_id, nombre);

                -- Índice parcial imprescindible, no un extra.
                --
                -- En SQLite dos NULL no son iguales entre sí, así que el índice
                -- de arriba NO impide meter 'Blanco' cien veces mientras
                -- usuario_id sea NULL — y NULL es justo el estado de las dos PCs
                -- en producción, que no tienen login. Sin esto, el
                -- INSERT OR IGNORE de cada venta iría acumulando duplicados en
                -- el catálogo, que es exactamente lo que la v2 evitaba.
                CREATE UNIQUE INDEX idx_colores_hilo_sin_usuario
                    ON colores_hilo(nombre) WHERE usuario_id IS NULL;

                CREATE TABLE tipos_hilo_new (
                    id INTEGER PRIMARY KEY,
                    usuario_id TEXT REFERENCES usuarios(id_usuario),
                    nombre TEXT NOT NULL COLLATE NOCASE,
                    sync_estado TEXT NOT NULL DEFAULT 'local'
                );
                INSERT INTO tipos_hilo_new (id, usuario_id, nombre, sync_estado)
                SELECT id, NULL, nombre, 'local' FROM tipos_hilo;
                DROP TABLE tipos_hilo;
                ALTER TABLE tipos_hilo_new RENAME TO tipos_hilo;
                CREATE UNIQUE INDEX idx_tipos_hilo_usuario_nombre
                    ON tipos_hilo(usuario_id, nombre);
                CREATE UNIQUE INDEX idx_tipos_hilo_sin_usuario
                    ON tipos_hilo(nombre) WHERE usuario_id IS NULL;

                CREATE TABLE configuracion_new (
                    usuario_id TEXT REFERENCES usuarios(id_usuario),
                    clave TEXT NOT NULL,
                    valor TEXT NOT NULL,
                    PRIMARY KEY (usuario_id, clave)
                );
                INSERT INTO configuracion_new (usuario_id, clave, valor)
                SELECT NULL, clave, valor FROM configuracion;
                DROP TABLE configuracion;
                ALTER TABLE configuracion_new RENAME TO configuracion;

                -- Mismo problema del NULL que arriba, y aquí duele más: una PK
                -- compuesta (usuario_id, clave) con usuario_id NULL deja entrar
                -- dos filas con la misma clave, y entonces 'maneja_tipos_hilo'
                -- podría leerse 'true' o 'false' según cuál devuelva el motor.
                CREATE UNIQUE INDEX idx_configuracion_sin_usuario
                    ON configuracion(clave) WHERE usuario_id IS NULL;
            ",
            kind: MigrationKind::Up,
        },
    ]
}
