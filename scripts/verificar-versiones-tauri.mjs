// Revisa que cada paquete de Tauri en npm tenga la misma versión mayor.menor
// que su crate de Rust, que es lo que exige `tauri build` antes de compilar.
//
// Existe porque la verificación de PR no corre `tauri build` (tardaría
// demasiado), y sin esto un desfase solo aparece al etiquetar el release:
// pasó en la 1.6.0, cuando npm subió @tauri-apps/api a 2.12 y Rust seguía
// en tauri 2.11.
//
// Uso: node scripts/verificar-versiones-tauri.mjs  (desde la raíz del repo)

import { readFileSync } from 'node:fs';

const lockNpm = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages;
const lockCargo = readFileSync('src-tauri/Cargo.lock', 'utf8');

// Cargo.lock repite el bloque [[package]] con name y version en líneas seguidas.
// El \r? es porque en Windows git lo deja con saltos de línea CRLF.
const versionesCargo = new Map();
for (const [, nombre, version] of lockCargo.matchAll(
  /name = "([^"]+)"\r?\nversion = "([^"]+)"/g
)) {
  versionesCargo.set(nombre, version);
}

// Si no se leyó nada, el formato cambió y el script estaría aprobando sin
// revisar: mejor fallar.
if (versionesCargo.size === 0) {
  console.error('No se pudo leer ninguna versión de src-tauri/Cargo.lock.');
  process.exit(1);
}

const mayorMenor = (v) => v.split('.').slice(0, 2).join('.');

const desfases = [];
let revisados = 0;
for (const [ruta, datos] of Object.entries(lockNpm)) {
  const paquete = ruta.match(/^node_modules\/@tauri-apps\/([^/]+)$/)?.[1];
  // El CLI no se empareja con un crate de la app: tiene su propia versión.
  if (!paquete || paquete.startsWith('cli')) continue;

  const crate = paquete === 'api' ? 'tauri' : `tauri-${paquete}`;
  const versionCargo = versionesCargo.get(crate);
  if (!versionCargo) continue;

  revisados++;
  if (mayorMenor(datos.version) !== mayorMenor(versionCargo)) {
    desfases.push(`  @tauri-apps/${paquete} ${datos.version}  ≠  ${crate} ${versionCargo}`);
  }
}

// Mismo motivo: cero paquetes revisados significa que algo no se leyó bien.
if (revisados === 0) {
  console.error('No se encontró ningún paquete @tauri-apps para comparar en package-lock.json.');
  process.exit(1);
}

if (desfases.length > 0) {
  console.error('Versiones de Tauri desfasadas entre npm y Rust (deben coincidir en mayor.menor):');
  console.error(desfases.join('\n'));
  console.error('\nFija la versión en package.json (con ~) o actualiza el crate con cargo update.');
  process.exit(1);
}

console.log(`Versiones de Tauri alineadas entre npm y Rust (${revisados} paquetes).`);
