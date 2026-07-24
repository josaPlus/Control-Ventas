// ============================================
// CLIENTE
// ============================================
export interface Cliente {
  id?: number;              // opcional: no existe hasta que se inserta (autoincrement)
  comprador: string;
  domicilio: string;
  telefono: string;         // se valida que sean solo dígitos antes de guardar
}

// ============================================
// DETALLE DE VENTA (una línea por tipo de piña)
// ============================================
export interface DetalleVenta {
  id?: number;
  nota_venta_id?: number;   // se asigna al guardar la nota
  color_pina: string;
  cantidad_pinas: number;
  precio_pina: number;      // double -> REAL en SQLite
  subtotal: number;         // cantidad_pinas * precio_pina, calculado en frontend
}

// ============================================
// NOTA DE VENTA (cabecera)
// ============================================
export interface NotaVenta {
  id?: number;
  numero_nota: number;
  cliente_id: number;
  fecha: string;             // formato ISO "YYYY-MM-DD", se convierte a Date en UI
  tipo_deposito: 'efectivo' | 'deposito';
  pagado: boolean;           // se convierte a 0/1 al guardar en SQLite
  comentario?: string;       // opcional, TEXT en SQLite
  total_venta: number;       // suma de todos los subtotales del detalle
}

// ============================================
// NOTA DE VENTA COMPLETA (cabecera + detalle + datos del cliente)
// útil para mostrar en pantalla sin hacer varias consultas
// ============================================
export interface NotaVentaCompleta extends NotaVenta {
  cliente: Cliente;
  detalles: DetalleVenta[];
}