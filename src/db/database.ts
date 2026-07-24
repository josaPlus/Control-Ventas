import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { Cliente, NotaVenta, DetalleVenta, NotaVentaCompleta } from '../types/models';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:ventas.db');
  }
  return db;
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
    detalles: detalles.map((d) => ({
      color_pina: d.color_pina,
      cantidad_pinas: d.cantidad_pinas,
      precio_pina: d.precio_pina,
      subtotal: d.subtotal,
    })),
  });
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