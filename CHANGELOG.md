# Changelog

Todos los cambios relevantes de **Control de Ventas** (piñas de hilo).

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/): se sube la segunda
cifra cuando hay función nueva y la tercera cuando solo son correcciones.

---

## [1.5.0] — 2026-10-02

Nueva versión con cuentas de usuario, conexión con el servidor central y folio inicial configurable para las notas de venta.

Iniciar sesión es opcional: si no lo haces, la aplicación sigue funcionando igual que antes, con todos tus datos guardados en esta computadora.

### Añadido

**Cuentas de usuario (opcional)**
- Pantalla de inicio de sesión, accesible desde la barra lateral. Permite
  crear una cuenta o entrar con una existente.
- Se puede entrar con **el nombre de usuario o con el correo**, indistinto, y
  sin que importen las mayúsculas.
- Las contraseñas se guardan cifradas con Argon2id. Nunca se guardan ni se
  envían en texto plano.
- La sesión se recuerda entre reinicios: al reabrir la app no se vuelve a
  pedir la contraseña.
- La barra lateral muestra quién tiene la sesión abierta y si está conectada
  al servidor o trabajando solo en esa computadora.

**Catálogos y ajustes por usuario**
- Los colores, los tipos de hilo y la configuración ahora pertenecen a cada
  usuario. Dos vendedores en la misma computadora manejan su propia paleta sin
  pisarse.

**Asociar datos ya capturados**
- En Ajustes aparece "Datos de esta computadora" cuando hay información que no
  pertenece a ninguna cuenta: lo capturado antes de que existiera el login, o
  mientras se trabajó sin iniciar sesión.
- Un botón la asocia a la cuenta activa. Es una acción explícita y nunca
  ocurre sola al iniciar sesión — en una computadora compartida, el primer
  login no debe apropiarse de las ventas de otra persona.
- Si una entrada de catálogo ya existe en la cuenta, se conserva la de la
  cuenta y se descarta la copia suelta, sin duplicar.

**Conexión con el servidor**
- Al iniciar sesión, la app intenta autenticar contra la API por **HTTPS**. Si
  lo logra, la sesión queda respaldada por el servidor.
- **Si el servidor no responde, el login continúa contra la base local sin
  mostrar ningún error.** Trabajar sin conexión es un modo normal, no una
  falla.
- Las cuentas nuevas se dan de alta también en el servidor, para que la misma
  cuenta sirva en las dos computadoras.
- En Ajustes, "Copia en el servidor" muestra cuántos clientes, ventas y
  entradas de catálogo faltan por enviar, y permite mandarlos con un botón.
  Enviar dos veces no duplica nada.
- El identificador de sesión del servidor se guarda en el **Administrador de
  credenciales de Windows**, no en la base de datos ni en el navegador
  interno.

**Numeración de notas**
- En Ajustes se puede fijar el **folio inicial** (por ejemplo, continuar desde
  el 3000 del talonario de papel).
- Funciona como piso, no como reinicio: la numeración nunca retrocede ni
  repite un número ya usado.

### Corregido

- En los buscadores de Clientes, Historial de ventas y el selector de cliente
  de Nueva Venta, el ícono de lupa quedaba encima del texto que se escribía.

### Notas técnicas

- Migraciones de base de datos **v3** y **v4**. Son aditivas y conservan todo
  lo capturado; se verificó que los conteos de filas no cambian al aplicarlas.
- La dirección del servidor se fija al compilar, desde
  `CONTROL_VENTAS_API_URL_POR_DEFECTO` en `src-tauri/.env` (y desde un secret
  del repositorio en las compilaciones automáticas). Puede sobrescribirse por
  instalación sin recompilar.
- El servidor usa un certificado firmado por una CA propia. Esa CA debe estar
  instalada en `Cert:\LocalMachine\Root` de cada computadora; la validación
  TLS se hace de forma estándar contra el almacén de Windows, sin excepciones
  ni validaciones desactivadas.

---

## [1.4.0] — 2026-08-10

### Añadido
- **Reportes semanales.** La pantalla de Reportes ahora permite elegir entre
  mensual y semanal. Se escoge cualquier día y la app exporta la semana
  completa de lunes a domingo, con subtotal por día y total de la semana.
- Botones para moverse a la semana anterior o siguiente, y una línea que
  confirma el rango exacto que se va a exportar.

### Corregido
- Los cortes de semana se recorrían un día. Las fechas se interpretaban como
  horario universal en lugar del local, así que una venta del lunes podía caer
  en la semana anterior. Esto también corrige los subtotales semanales que ya
  aparecían dentro del reporte mensual.

---

## [1.3.2] — 2026-08-04

### Corregido
- Se revirtió el instalador de WebView2 a `downloadBootstrapper`, el método
  que traía la 1.3.0, al no resultar conveniente el cambio de la 1.3.1.

---

## [1.3.1] — 2026-08-04

### Corregido
- Intento de solución a fallos al instalar WebView2 en equipos nuevos,
  empaquetando el instalador completo (`offlineInstaller`).

---

## [1.3.0] — 2026-07-29

### Añadido
- **Reportes mensuales en Excel.** Exporta todas las ventas de un mes con su
  detalle por línea, subtotales por semana y total del mes, con el archivo
  listo para imprimir o enviar.
- El reporte se guarda en `Documentos / Control de Ventas / Save`, y avisa
  antes de reemplazar uno existente.

---

## [1.2.0] — 2026-07-28

### Añadido
- **Catálogos de hilo configurables.** Los colores y los tipos de hilo dejan
  de estar fijos en el programa: se llenan solos conforme se capturan ventas y
  se pueden corregir, renombrar o eliminar desde Ajustes.
- Al renombrar un color o un tipo, el cambio se aplica también a las ventas ya
  registradas, para que el historial no quede con el nombre mal escrito.
- Ajuste para elegir si el negocio maneja un solo tipo de hilo o varios. Si es
  uno solo, el campo no aparece al capturar.
- Los nombres se normalizan al guardarse, de modo que "CAFÉ", "café" y "Café"
  no entren como tres colores distintos.

---

## [1.1.0] — 2026-07-26

### Añadido
- **Panel de control de piñas vendidas**, con el análisis de ganancias y
  pérdidas del negocio.
- README con la descripción del proyecto.

---

## [1.0.1] — 2026-07-25

### Cambiado
- Icono de la aplicación.

---

## [1.0.0] — 2026-07-25

Primera versión utilizable.

### Añadido
- Captura de notas de venta con varias líneas de detalle, guardadas en una
  sola operación: o se guarda la nota completa, o no se guarda nada.
- Alta, consulta, edición y baja de clientes, incluyendo crear un cliente sin
  salir del formulario de venta.
- Pantallas de Nueva Venta, Historial de Ventas y Clientes.
- Base de datos SQLite local, sin necesidad de conexión a internet.
- Actualizaciones automáticas de la aplicación.