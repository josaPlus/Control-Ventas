// Todo lo que decide el tamaño del logo vive aquí: cómo se prepara al guardarlo
// y cuánto mide en la nota. La vista previa de Ajustes y el PDF usan las mismas
// funciones, así que lo que se ve antes de generar es lo que sale impreso.

const MM_POR_PULGADA = 25.4;

// Recuadro del logo en la nota de remisión (esquina superior izquierda).
export const LOGO_ANCHO_MM = 36;
export const LOGO_ALTO_MM = 11.5;

// Por debajo de esta resolución se empiezan a notar los cuadritos en papel.
// Un logo nunca se imprime más grande de lo que esto permite.
const DPI_MINIMO_IMPRESION = 150;
// Lo que pide una impresora láser para verse nítido.
const DPI_OBJETIVO = 300;
// Un logo chico se agranda con suavizado al guardarlo, pero solo hasta el
// doble: más allá ya no gana nitidez, solo se ve difuminado.
const AMPLIACION_MAXIMA = 2;

// Tope de lo que se guarda: unos 560 dpi sobre el recuadro, de sobra para
// imprimir y aun así decenas de KB.
const ANCHO_MAXIMO_PX = 800;
const ALTO_MAXIMO_PX = 260;

const TIPOS_ACEPTADOS = ['image/png', 'image/jpeg', 'image/webp'];
// Generoso a propósito: la imagen se reduce antes de guardarse, así que el
// peso del original no llega a la base. Solo evita abrir archivos absurdos.
const TAMANO_MAXIMO = 15 * 1024 * 1024;

export class ErrorLogo extends Error {}

/** Resolución que tendría la imagen si llenara el recuadro completo. */
function dpiAlLlenarRecuadro(anchoPx: number, altoPx: number): number {
  const mmPorPx = Math.min(LOGO_ANCHO_MM / anchoPx, LOGO_ALTO_MM / altoPx);
  return MM_POR_PULGADA / mmPorPx;
}

/**
 * Tamaño en mm con el que el logo se imprime en la nota. Llena el recuadro sin
 * deformarse, salvo que eso lo deje por debajo de DPI_MINIMO_IMPRESION: en ese
 * caso sale más chico, pero nítido.
 */
export function medidasLogoEnNota(
  anchoPx: number,
  altoPx: number
): { ancho: number; alto: number; reducido: boolean } {
  const mmParaLlenar = Math.min(LOGO_ANCHO_MM / anchoPx, LOGO_ALTO_MM / altoPx);
  const mmMaximoPorPx = MM_POR_PULGADA / DPI_MINIMO_IMPRESION;
  const mmPorPx = Math.min(mmParaLlenar, mmMaximoPorPx);
  return {
    ancho: anchoPx * mmPorPx,
    alto: altoPx * mmPorPx,
    reducido: mmPorPx < mmParaLlenar,
  };
}

function cargarImagen(archivo: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(archivo);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ErrorLogo('El archivo no se pudo abrir como imagen. Puede estar dañado.'));
    };
    img.src = url;
  });
}

function lienzo(ancho: number, alto: number) {
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ErrorLogo('No se pudo procesar la imagen.');
  // El suavizado por defecto de Chromium es el de menor calidad: al reducir
  // mucho deja dientes en las orillas y se come las letras finas del logo.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function redimensionar(img: HTMLImageElement, ancho: number, alto: number): HTMLCanvasElement {
  let origen: CanvasImageSource = img;
  let anchoActual = img.naturalWidth;
  let altoActual = img.naturalHeight;

  // Una reducción grande de un solo salto pierde detalle aun con suavizado
  // alto. Reducir a la mitad varias veces conserva mejor los trazos delgados.
  while (anchoActual / 2 >= ancho && altoActual / 2 >= alto) {
    anchoActual = Math.round(anchoActual / 2);
    altoActual = Math.round(altoActual / 2);
    const paso = lienzo(anchoActual, altoActual);
    paso.ctx.drawImage(origen, 0, 0, anchoActual, altoActual);
    origen = paso.canvas;
  }

  const final = lienzo(ancho, alto);
  final.ctx.drawImage(origen, 0, 0, ancho, alto);
  return final.canvas;
}

export interface LogoPreparado {
  dataUrl: string;
  /** La original no alcanzaba para imprimirse nítida llenando el recuadro. */
  pequena: boolean;
}

/** Valida la imagen y la deja del tamaño adecuado para la nota. */
export async function prepararLogo(archivo: File): Promise<LogoPreparado> {
  if (!TIPOS_ACEPTADOS.includes(archivo.type)) {
    throw new ErrorLogo('Elige una imagen PNG, JPG o WEBP.');
  }
  if (archivo.size > TAMANO_MAXIMO) {
    throw new ErrorLogo('La imagen pesa más de 15 MB. Elige una más ligera.');
  }

  const img = await cargarImagen(archivo);
  const anchoOriginal = img.naturalWidth;
  const altoOriginal = img.naturalHeight;
  const dpiOriginal = dpiAlLlenarRecuadro(anchoOriginal, altoOriginal);

  const escalaReduccion = Math.min(
    1,
    ANCHO_MAXIMO_PX / anchoOriginal,
    ALTO_MAXIMO_PX / altoOriginal
  );
  // Si no hubo que reducirla, se ve si le hace falta agrandarse para llegar a
  // DPI_OBJETIVO. El suavizado alto hace que salga difuminada en vez de
  // pixeleada, que en papel se ve mucho mejor.
  const escala =
    escalaReduccion < 1
      ? escalaReduccion
      : Math.max(1, Math.min(AMPLIACION_MAXIMA, DPI_OBJETIVO / dpiOriginal));

  const ancho = Math.max(1, Math.round(anchoOriginal * escala));
  const alto = Math.max(1, Math.round(altoOriginal * escala));
  const canvas = redimensionar(img, ancho, alto);

  // Un JPG no tiene transparencia, así que se queda en JPG, que pesa mucho
  // menos. PNG y WEBP salen como PNG: conservan el fondo transparente y jsPDF
  // no sabe incrustar WEBP.
  const dataUrl =
    archivo.type === 'image/jpeg'
      ? canvas.toDataURL('image/jpeg', 0.92)
      : canvas.toDataURL('image/png');

  return { dataUrl, pequena: dpiOriginal < DPI_MINIMO_IMPRESION };
}
