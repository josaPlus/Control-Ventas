// Convierte un importe a letra, como se acostumbra en las notas y facturas
// mexicanas: "TRECE MIL SEISCIENTOS VEINTE PESOS 00/100 M.N.".
//
// Va en letra porque una cifra escrita con número se puede alterar con un
// trazo; el texto no.

const UNIDADES = [
  '',
  'UNO',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
  'VEINTE',
];

const DECENAS = [
  '',
  '',
  'VEINTE',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];

const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

/** 0-999 en letra. */
function centenasALetras(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';

  const c = Math.floor(n / 100);
  const resto = n % 100;

  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);

  if (resto <= 20) {
    if (resto > 0) partes.push(UNIDADES[resto]);
  } else if (resto < 30) {
    // 21-29 se escriben en una sola palabra: veintiuno, veintidós...
    const u = resto - 20;
    const acentuadas: Record<number, string> = { 2: 'VEINTIDÓS', 3: 'VEINTITRÉS', 6: 'VEINTISÉIS' };
    partes.push(acentuadas[u] ?? `VEINTI${UNIDADES[u]}`);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    partes.push(u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`);
  }

  return partes.join(' ');
}

/** Parte entera en letra, sin la palabra "pesos". */
function enteroALetras(n: number): string {
  if (n === 0) return 'CERO';

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];

  if (millones > 0) {
    partes.push(
      millones === 1 ? 'UN MILLÓN' : `${apocopar(centenasALetras(millones))} MILLONES`
    );
  }

  if (miles > 0) {
    // "mil", no "un mil".
    partes.push(miles === 1 ? 'MIL' : `${apocopar(centenasALetras(miles))} MIL`);
  }

  if (resto > 0) partes.push(centenasALetras(resto));

  return partes.join(' ');
}

/**
 * "UNO" pierde la o delante de un sustantivo masculino: veintiún mil, treinta y
 * un pesos. Sin esto saldría "veintiuno mil pesos".
 */
function apocopar(texto: string): string {
  if (texto === 'UNO') return 'UN';
  if (texto.endsWith('VEINTIUNO')) return texto.replace(/VEINTIUNO$/, 'VEINTIÚN');
  if (texto.endsWith(' UNO')) return texto.replace(/ UNO$/, ' UN');
  return texto;
}

export function numeroALetras(monto: number): string {
  const seguro = Math.abs(Math.round((monto ?? 0) * 100) / 100);
  const entero = Math.floor(seguro);
  const centavos = Math.round((seguro - entero) * 100);

  const letras = apocopar(enteroALetras(entero));
  const moneda = entero === 1 ? 'PESO' : 'PESOS';

  // "UN MILLÓN DE PESOS", pero "UN MILLÓN DOSCIENTOS MIL PESOS": el "de" solo
  // aparece cuando la cifra termina justo en millón.
  const de = entero >= 1_000_000 && entero % 1_000_000 === 0 ? 'DE ' : '';

  return `${letras} ${de}${moneda} ${String(centavos).padStart(2, '0')}/100 M.N.`;
}
