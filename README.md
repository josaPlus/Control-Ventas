# Control de Ventas · Piñas de Hilo

Aplicación de escritorio para llevar el control de ventas de un negocio de piñas de hilo: registro de clientes, notas de venta, historial con filtros y un panel (dashboard) con estadísticas del negocio.

Construida con **Tauri 2 + React + TypeScript**, con una base de datos **SQLite local** administrada desde el backend en Rust.

## Características

- **Dashboard**: total vendido hoy, esta semana y este mes; gráfica de ventas de los últimos 14 días; ventas por color de piña; resumen de pagado vs. pendiente.
- **Nueva venta**: registro de notas de venta con múltiples líneas de detalle (color, cantidad y precio por piña), selección de cliente con autocompletado y opción de dar de alta un cliente nuevo al vuelo.
- **Historial de ventas**: listado de notas con filtros por rango de fechas, estado de pago y comprador; vista de detalle, edición y eliminación de notas; alternar el estado "pagado / pendiente" directamente desde la tabla.
- **Clientes**: alta, edición, búsqueda y eliminación de compradores (protegida: no se puede borrar un cliente con ventas registradas).
- **Actualizaciones automáticas**: la app revisa e instala actualizaciones mediante el plugin `updater` de Tauri, apuntando a los releases de GitHub.

## Stack técnico

**Frontend**
- React 19 + TypeScript
- Vite 7
- React Router (`HashRouter`)
- React Hook Form + Zod (validación de formularios)
- Recharts (gráficas del dashboard)

**Backend / escritorio**
- Tauri 2 (Rust)
- `sqlx` sobre SQLite, con transacciones reales para operaciones de varios pasos (crear/actualizar nota de venta)
- Plugins de Tauri: `sql`, `updater`, `process`, `opener`

## Estructura del proyecto

```
src/
├── components/        # Formularios, modales, autocompletado, iconos, diálogos de confirmación
├── db/
│   └── database.ts    # Capa de acceso a datos: consultas SQL directas + invoke() a comandos de Rust
├── lib/                # Utilidades: formateo de moneda/fechas, cálculos para el dashboard
├── pages/
│   ├── Dashboard.tsx
│   ├── NuevaVenta.tsx
│   ├── HistorialVentas.tsx
│   └── Clientes.tsx
├── styles/
│   └── theme.css       # Tokens de diseño (colores, sombras, radios) compartidos por toda la app
├── types/
│   └── models.ts        # Interfaces: Cliente, NotaVenta, DetalleVenta, NotaVentaCompleta
└── App.tsx              # Enrutamiento principal

src-tauri/
├── src/lib.rs           # Comandos de Tauri (crear/actualizar/eliminar nota de venta y cliente)
├── capabilities/
│   └── default.json     # Permisos de la ventana principal
└── tauri.conf.json       # Configuración de la app y del updater
```

## Requisitos previos

- Node.js (LTS reciente)
- Rust y las dependencias del sistema para Tauri 2 ([guía oficial](https://v2.tauri.app/start/prerequisites/))

## Instalación y desarrollo

```bash
# Instalar dependencias
npm install

# Levantar la app en modo desarrollo (ventana de escritorio)
npm run tauri dev
```

## Compilación

```bash
# Compilar el frontend y generar el instalador/binario de escritorio
npm run tauri build
```

Otros scripts disponibles:

```bash
npm run dev        # Solo el frontend con Vite (sin la ventana de Tauri)
npm run build       # tsc + build de Vite
npm run preview     # Previsualizar el build de Vite
```

## Notas

- La base de datos SQLite (`ventas.db`) se crea y migra automáticamente al iniciar la app.
- El proyecto está identificado como `com.josaf.control-ventas` y publica actualizaciones a través de releases en `josaPlus/Control-Ventas` en GitHub.