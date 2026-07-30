import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { Cliente, NotaVenta, DetalleVenta, NotaVentaCompleta } from '../types/models';

// Se memoiza la promesa, no la conexión ya resuelta. Si se guardara la
// conexión, dos llamadas simultáneas al arrancar la app verían ambas el valor
// en null y dispararían dos Database.load() a la vez, con las migraciones
// corriendo por duplicado.
let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:ventas.db');
  }
  return await dbPromise;
}

// ============================================
// CLIENTES
// ============================================

export async function crearCliente(cliente: Cliente): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    'INSERT INTO clientes (comprador, domicilio, telefono) VALUES ($1, $2, $3)',
    [cliente.comprador, cliente.domicilio, cliente.telefono]
  );
  return result.lastInsertId!;
}

export async function listarClientes(): Promise<Cliente[]> {
  const database = await getDb();
  return await database.select<Cliente[]>(
    'SELECT * FROM clientes ORDER BY comprador ASC'
  );
}

export async function buscarClientes(texto: string): Promise<Cliente[]> {
  const database = await getDb();
  const filtro = `%${texto}%`;
  return await database.select<Cliente[]>(
    'SELECT * FROM clientes WHERE comprador LIKE $1 OR telefono LIKE $1 ORDER BY comprador ASC',
    [filtro]
  );
}

export async function actualizarCliente(cliente: Cliente): Promise<void> {
  const database = await getDb();
  await database.execute(
    'UPDATE clientes SET comprador = $1, domicilio = $2, telefono = $3 WHERE id = $4',
    [cliente.comprador, cliente.domicilio, cliente.telefono, cliente.id]
  );
}

// Sólo se puede borrar un cliente que no tenga ventas registradas. Si las
// tiene, el backend rechaza la operación con un mensaje explicando cuántas son.
export async function eliminarCliente(clienteId: number): Promise<void> {
  await invoke('eliminar_cliente', { clienteId });
}

// ============================================
// NOTAS DE VENTA
// ============================================

// Calcula el siguiente número de nota de forma automática y consecutiva
export async function obtenerSiguienteNumeroNota(): Promise<number> {
  const database = await getDb();
  const result = await database.select<{ siguiente: number }[]>(
    'SELECT COALESCE(MAX(numero_nota), 0) + 1 AS siguiente FROM notas_venta'
  );
  return result[0].siguiente;
}

// Forma en que el backend espera una línea de venta. Se comparte entre crear y
// editar para que las dos manden exactamente los mismos campos.
//
// tipo_hilo viaja como null cuando no aplica: Rust lo recibe como Option<String>
// y lo guarda como NULL. El texto se normaliza allá (espacios y mayúsculas),
// así que lo que quede guardado puede diferir de lo que se escribió.
function lineaParaBackend(d: Omit<DetalleVenta, 'id' | 'nota_venta_id'>) {
  return {
    color_pina: d.color_pina,
    cantidad_pinas: d.cantidad_pinas,
    precio_pina: d.precio_pina,
    tipo_hilo: d.tipo_hilo ?? null,
    subtotal: d.subtotal,
  };
}

// Inserta la nota de venta junto con todas sus líneas de detalle.
//
// El trabajo lo hace el comando `crear_nota_venta` de Rust (src-tauri/src/lib.rs),
// que abre una transacción real: o se guarda completo, o no se guarda nada.
// No se puede hacer desde aquí porque cada execute() del plugin de SQL usa una
// conexión distinta del pool y un BEGIN/COMMIT repartido entre conexiones
// termina en "database is locked".
//
// El número de nota también se asigna allá dentro de la transacción, por eso se
// devuelve junto con el id.
export async function crearNotaVenta(
  nota: Omit<NotaVenta, 'id' | 'numero_nota'>,
  detalles: Omit<DetalleVenta, 'id' | 'nota_venta_id'>[]
): Promise<{ id: number; numero_nota: number }> {
  return await invoke<{ id: number; numero_nota: number }>('crear_nota_venta', {
    nota: {
      cliente_id: nota.cliente_id,
      fecha: nota.fecha,
      tipo_deposito: nota.tipo_deposito,
      pagado: nota.pagado,
      comentario: nota.comentario ?? null,
      total_venta: nota.total_venta,
    },
    detalles: detalles.map(lineaParaBackend),
  });
}

// Reemplaza el contenido de una nota existente (cabecera + todas sus líneas).
// El número de nota no cambia: es el folio que el cliente ya tiene en su copia.
export async function actualizarNotaVenta(
  notaVentaId: number,
  nota: Omit<NotaVenta, 'id' | 'numero_nota'>,
  detalles: Omit<DetalleVenta, 'id' | 'nota_venta_id'>[]
): Promise<void> {
  await invoke('actualizar_nota_venta', {
    notaVentaId,
    nota: {
      cliente_id: nota.cliente_id,
      fecha: nota.fecha,
      tipo_deposito: nota.tipo_deposito,
      pagado: nota.pagado,
      comentario: nota.comentario ?? null,
      total_venta: nota.total_venta,
    },
    detalles: detalles.map(lineaParaBackend),
  });
}

// Borra la nota junto con todas sus líneas de detalle.
export async function eliminarNotaVenta(notaVentaId: number): Promise<void> {
  await invoke('eliminar_nota_venta', { notaVentaId });
}

// Trae todas las notas con su cliente (para el historial)
export async function listarNotasVenta(): Promise<(NotaVenta & { comprador: string })[]> {
  const database = await getDb();
  const rows = await database.select<any[]>(
    `SELECT nv.*, c.comprador 
     FROM notas_venta nv
     JOIN clientes c ON c.id = nv.cliente_id
     ORDER BY nv.fecha DESC, nv.numero_nota DESC`
  );
  return rows.map((r) => ({ ...r, pagado: !!r.pagado }));
}

// Trae una nota completa: cabecera + cliente + todas sus líneas de detalle
export async function obtenerNotaCompleta(
  notaVentaId: number
): Promise<NotaVentaCompleta | null> {
  const database = await getDb();

  const notas = await database.select<any[]>(
    'SELECT * FROM notas_venta WHERE id = $1',
    [notaVentaId]
  );
  if (notas.length === 0) return null;
  const notaRaw = notas[0];

  const clientes = await database.select<Cliente[]>(
    'SELECT * FROM clientes WHERE id = $1',
    [notaRaw.cliente_id]
  );

  const detalles = await database.select<DetalleVenta[]>(
    'SELECT * FROM detalle_venta WHERE nota_venta_id = $1',
    [notaVentaId]
  );

  return {
    ...notaRaw,
    pagado: !!notaRaw.pagado,
    cliente: clientes[0],
    detalles,
  };
}

// Actualiza el estado de pago (útil para el toggle "pagado / no pagado")
export async function actualizarEstadoPago(
  notaVentaId: number,
  pagado: boolean
): Promise<void> {
  const database = await getDb();
  await database.execute(
    'UPDATE notas_venta SET pagado = $1 WHERE id = $2',
    [pagado ? 1 : 0, notaVentaId]
  );
}

// ============================================
// CATÁLOGOS DE HILO
// ============================================

// Los mismos dos valores que acepta el enum Catalogo de Rust. Al ser un tipo
// literal, TypeScript impide que llegue cualquier otra cadena a la consulta.
export type Catalogo = 'colores_hilo' | 'tipos_hilo';

// Los catálogos se llenan solos al guardar una venta (lo hace Rust, dentro de
// la transacción). Aquí solo se leen, para alimentar las sugerencias.
//
// El nombre de tabla se interpola porque SQL no permite bindearlo como
// parámetro; el tipo Catalogo es lo que lo mantiene acotado.
export async function leerCatalogo(catalogo: Catalogo): Promise<string[]> {
  const database = await getDb();
  const filas = await database.select<{ nombre: string }[]>(
    `SELECT nombre FROM ${catalogo} ORDER BY nombre COLLATE NOCASE ASC`
  );
  return filas.map((f) => f.nombre);
}

// Da de alta una entrada a mano. Devuelve el nombre ya normalizado, que es el
// que hay que dejar seleccionado: si el usuario escribió "CAFÉ", lo que queda
// guardado es "Café".
export async function agregarEntradaCatalogo(
  catalogo: Catalogo,
  nombre: string
): Promise<string> {
  return await invoke<string>('agregar_entrada_catalogo', { catalogo, nombre });
}

// Cuántas líneas de venta usan este valor. Sirve para avisar antes de borrarlo.
export async function contarUsoEnVentas(catalogo: Catalogo, nombre: string): Promise<number> {
  return await invoke<number>('contar_uso_en_ventas', { catalogo, nombre });
}

// Renombra la entrada del catálogo Y las ventas que la usan, en una
// transacción. Si el nombre nuevo ya existe, las dos entradas se fusionan.
// Devuelve cuántas líneas de venta se actualizaron.
export async function renombrarEntradaCatalogo(
  catalogo: Catalogo,
  nombreActual: string,
  nombreNuevo: string
): Promise<number> {
  return await invoke<number>('renombrar_entrada_catalogo', {
    catalogo,
    nombreActual,
    nombreNuevo,
  });
}

// Quita la entrada de las sugerencias. Las ventas ya registradas conservan su
// texto: no hay llave foránea entre el catálogo y el detalle.
export async function eliminarEntradaCatalogo(catalogo: Catalogo, nombre: string): Promise<void> {
  await invoke('eliminar_entrada_catalogo', { catalogo, nombre });
}

// Cuántas líneas de venta llevan tipo de hilo registrado. Se usa para avisar
// antes de apagar el ajuste de "varios tipos".
export async function contarLineasConTipoHilo(): Promise<number> {
  const database = await getDb();
  const filas = await database.select<{ total: number }[]>(
    `SELECT COUNT(*) AS total FROM detalle_venta
      WHERE tipo_hilo IS NOT NULL AND TRIM(tipo_hilo) <> ''`
  );
  return filas[0]?.total ?? 0;
}

// ============================================
// CONFIGURACIÓN
// ============================================

// Si el negocio maneja varios tipos de hilo. Decide si el campo aparece en el
// formulario de venta. Ausente = todavía no se ha configurado la app.
export const CLAVE_MANEJA_TIPOS = 'maneja_tipos_hilo';

export async function leerConfiguracion(clave: string): Promise<string | null> {
  const database = await getDb();
  const filas = await database.select<{ valor: string }[]>(
    'SELECT valor FROM configuracion WHERE clave = $1',
    [clave]
  );
  return filas.length > 0 ? filas[0].valor : null;
}

// Distingue una instalación recién estrenada de una que ya venía funcionando.
// Se usa para no mostrarle el asistente de bienvenida a alguien que lleva meses
// capturando ventas y solo actualizó la app.
export async function baseTieneDatos(): Promise<boolean> {
  const database = await getDb();
  const filas = await database.select<{ total: number }[]>(
    `SELECT (SELECT COUNT(*) FROM clientes) + (SELECT COUNT(*) FROM notas_venta) AS total`
  );
  return (filas[0]?.total ?? 0) > 0;
}

export async function guardarConfiguracion(clave: string, valor: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    `INSERT INTO configuracion (clave, valor) VALUES ($1, $2)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    [clave, valor]
  );
}

// EXPORTAR DATOS A EXCEL

export interface FilaReporteMensual {
  numeroNota: number;
  fecha: string;
  comprador: string;
  domicilio: string;
  telefono: string;
  colorPina: string;
  tipoHilo: string | null;
  cantidadPinas: number;
  precioPina: number;
  subtotal: number;
  tipoDeposito: string;
  pagado: boolean;
  comentario: string | null;
}

// anio: 2026, mes: 1-12
export async function obtenerFilasReporteMensual(
  anio: number,
  mes: number
): Promise<FilaReporteMensual[]> {
  const database = await getDb();
  const mesStr = String(mes).padStart(2, '0');
  const desde = `${anio}-${mesStr}-01`;
  // día 32 "desborda" al mes siguiente en formato texto ISO, así que
  // comparamos con < inicio del mes siguiente en vez de calcular el último día
  const anioSiguiente = mes === 12 ? anio + 1 : anio;
  const mesSiguiente = mes === 12 ? 1 : mes + 1;
  const hasta = `${anioSiguiente}-${String(mesSiguiente).padStart(2, '0')}-01`;

  const filas = await database.select<any[]>(
    `SELECT
       nv.numero_nota   AS numeroNota,
       nv.fecha         AS fecha,
       c.comprador      AS comprador,
       c.domicilio      AS domicilio,
       c.telefono       AS telefono,
       dv.color_pina    AS colorPina,
       dv.tipo_hilo     AS tipoHilo,
       dv.cantidad_pinas AS cantidadPinas,
       dv.precio_pina   AS precioPina,
       dv.subtotal      AS subtotal,
       nv.tipo_deposito AS tipoDeposito,
       nv.pagado        AS pagado,
       nv.comentario    AS comentario
     FROM notas_venta nv
     JOIN clientes c ON c.id = nv.cliente_id
     JOIN detalle_venta dv ON dv.nota_venta_id = nv.id
     WHERE nv.fecha >= $1 AND nv.fecha < $2
     ORDER BY nv.fecha ASC, nv.numero_nota ASC, dv.id ASC`,
    [desde, hasta]
  );

  return filas.map((f) => ({ ...f, pagado: !!f.pagado }));
}