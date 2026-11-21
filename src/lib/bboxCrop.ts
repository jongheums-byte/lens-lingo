import type { Box2D, StickerShape } from '../types/app';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StickerRenderOptions {
  shape?: StickerShape;
  whiteBorder?: boolean;
  outputSize?: number;
  zoom?: number;
  offsetX?: number; // -0.5..0.5 normalized shift
  offsetY?: number; // -0.5..0.5 normalized shift
}

/**
 * Converts Gemini normalized [ymin, xmin, ymax, xmax] (0..1000) into pixel CropRect.
 * Falls back to a centered 65% square if box2d is missing or degenerate.
 */
export function descaleBox2d(
  box2d: Box2D | undefined,
  imgWidth: number,
  imgHeight: number,
  paddingRatio = 0.12,
): CropRect {
  const safeW = Math.max(1, imgWidth);
  const safeH = Math.max(1, imgHeight);

  if (!box2d || box2d.length !== 4 || box2d.some((v) => !Number.isFinite(v))) {
    const side = Math.round(Math.min(safeW, safeH) * 0.65);
    return {
      x: Math.max(0, Math.round((safeW - side) / 2)),
      y: Math.max(0, Math.round((safeH - side) / 2)),
      width: side,
      height: side,
    };
  }

  const ymin = Math.max(0, Math.min(1000, Math.min(box2d[0], box2d[2])));
  const ymax = Math.max(0, Math.min(1000, Math.max(box2d[0], box2d[2])));
  const xmin = Math.max(0, Math.min(1000, Math.min(box2d[1], box2d[3])));
  const xmax = Math.max(0, Math.min(1000, Math.max(box2d[1], box2d[3])));

  const rawW = ((xmax - xmin) / 1000) * safeW;
  const rawH = ((ymax - ymin) / 1000) * safeH;

  if (rawW < 12 || rawH < 12) {
    const side = Math.round(Math.min(safeW, safeH) * 0.6);
    return {
      x: Math.max(0, Math.round((safeW - side) / 2)),
      y: Math.max(0, Math.round((safeH - side) / 2)),
      width: side,
      height: side,
    };
  }

  // Expand slightly into a balanced square-ish crop around the object center
  const side = Math.min(Math.max(safeW, safeH), Math.max(rawW, rawH) * (1 + paddingRatio * 2));
  const cx = ((xmin + xmax) / 2000) * safeW;
  const cy = ((ymin + ymax) / 2000) * safeH;

  const clampedW = Math.min(safeW, Math.max(24, Math.round(side)));
  const clampedH = Math.min(safeH, Math.max(24, Math.round(side)));

  const x = Math.max(0, Math.min(safeW - clampedW, Math.round(cx - clampedW / 2)));
  const y = Math.max(0, Math.min(safeH - clampedH, Math.round(cy - clampedH / 2)));

  return { x, y, width: clampedW, height: clampedH };
}

/**
 * Applies interactive zoom & pan offsets to a base CropRect within image bounds.
 */
export function adjustCropRect(
  base: CropRect,
  imgWidth: number,
  imgHeight: number,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
): CropRect {
  const safeZoom = Math.max(0.5, Math.min(3.0, zoom));
  const targetW = Math.min(imgWidth, Math.max(24, base.width / safeZoom));
  const targetH = Math.min(imgHeight, Math.max(24, base.height / safeZoom));

  const cx = base.x + base.width / 2 + offsetX * imgWidth * 0.35;
  const cy = base.y + base.height / 2 + offsetY * imgHeight * 0.35;

  const x = Math.max(0, Math.min(imgWidth - targetW, Math.round(cx - targetW / 2)));
  const y = Math.max(0, Math.min(imgHeight - targetH, Math.round(cy - targetH / 2)));

  return {
    x,
    y,
    width: Math.round(targetW),
    height: Math.round(targetH),
  };
}

function traceShapePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: StickerShape,
): void {
  ctx.beginPath();
  if (shape === 'circle') {
    const r = Math.min(w, h) / 2;
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
  } else if (shape === 'pill') {
    const r = Math.min(w, h) * 0.42;
    ctx.roundRect(x, y, w, h, r);
  } else if (shape === 'polaroid') {
    ctx.roundRect(x, y, w, h, 14);
  } else {
    ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.22);
  }
  ctx.closePath();
}

/**
 * Draws a die-cut sticker onto an HTMLCanvasElement or offscreen canvas and returns a data URL.
 */
export function renderStickerToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  baseRect: CropRect,
  options: StickerRenderOptions = {},
): HTMLCanvasElement {
  const size = options.outputSize ?? 360;
  const shape = options.shape ?? 'rounded';
  const whiteBorder = options.whiteBorder ?? true;

  const srcW = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  const rect = adjustCropRect(baseRect, srcW, srcH, options.zoom ?? 1, options.offsetX ?? 0, options.offsetY ?? 0);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const pad = whiteBorder ? Math.round(size * 0.065) : Math.round(size * 0.03);
  const borderWidth = whiteBorder ? Math.round(size * 0.045) : 0;

  // Outer soft drop shadow & white die-cut backing
  ctx.save();
  ctx.shadowColor = 'rgba(2, 6, 23, 0.45)';
  ctx.shadowBlur = Math.round(size * 0.05);
  ctx.shadowOffsetY = Math.round(size * 0.025);

  if (whiteBorder) {
    ctx.fillStyle = '#FFFFFF';
    traceShapePath(ctx, pad, pad, size - pad * 2, size - pad * 2, shape);
    ctx.fill();
  }
  ctx.restore();

  // Inner image region
  const imgX = pad + borderWidth;
  const imgY = pad + borderWidth;
  const imgW = size - (pad + borderWidth) * 2;
  const imgH = shape === 'polaroid' && whiteBorder ? Math.round((size - (pad + borderWidth) * 2) * 0.82) : size - (pad + borderWidth) * 2;

  ctx.save();
  traceShapePath(ctx, imgX, imgY, imgW, imgH, shape === 'polaroid' ? 'rounded' : shape);
  ctx.clip();

  // Cover-fit source crop rect into imgW x imgH
  const scale = Math.max(imgW / Math.max(1, rect.width), imgH / Math.max(1, rect.height));
  const drawW = rect.width * scale;
  const drawH = rect.height * scale;
  const drawX = imgX + (imgW - drawW) / 2;
  const drawY = imgY + (imgH - drawH) / 2;

  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, drawX, drawY, drawW, drawH);
  ctx.restore();

  // Subtle glossy rim highlight
  ctx.save();
  traceShapePath(ctx, imgX, imgY, imgW, imgH, shape === 'polaroid' ? 'rounded' : shape);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  return canvas;
}

export async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

export async function createStickerDataUrlFromImage(
  imageDataUrl: string,
  box2d?: Box2D,
  options: StickerRenderOptions = {},
): Promise<string> {
  const img = await loadImageElement(imageDataUrl);
  const baseRect = descaleBox2d(box2d, img.naturalWidth || img.width, img.naturalHeight || img.height);
  const canvas = renderStickerToCanvas(img, baseRect, options);
  const webp = canvas.toDataURL('image/webp', 0.88);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

/**
 * Generates a die-cut typographic badge sticker for vocabulary saved from text/voice Conversation Mode.
 */
export function createTextStickerDataUrl(
  word: string,
  emoji = '💬',
  accentColor = '#38BDF8',
): string {
  if (typeof document === 'undefined') return '';
  const size = 320;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const pad = 20;
  const border = 12;

  // White die-cut outer card with soft shadow
  ctx.save();
  ctx.shadowColor = 'rgba(2, 6, 23, 0.45)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#FFFFFF';
  traceShapePath(ctx, pad, pad, size - pad * 2, size - pad * 2, 'rounded');
  ctx.fill();
  ctx.restore();

  // Inner dark gradient fill
  const ix = pad + border;
  const iy = pad + border;
  const iw = size - (pad + border) * 2;
  const ih = iw;

  ctx.save();
  traceShapePath(ctx, ix, iy, iw, ih, 'rounded');
  ctx.clip();

  const grad = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.55, '#1e293b');
  grad.addColorStop(1, accentColor);
  ctx.fillStyle = grad;
  ctx.fillRect(ix, iy, iw, ih);

  // Subtle decorative glow orb
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.arc(ix + iw * 0.82, iy + ih * 0.22, 64, 0, Math.PI * 2);
  ctx.fill();

  // Emoji badge
  ctx.font = '68px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size * 0.36);

  // Word label (wrapped up to 2 lines cleanly)
  const cleanWord = word.trim();
  const fontSize = cleanWord.length > 16 ? 24 : cleanWord.length > 10 ? 28 : 34;
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

  const words = cleanWord.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= iw - 34) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);

  const displayLines = lines.slice(0, 2);
  if (lines.length > 2) {
    displayLines[1] = `${displayLines[1].slice(0, Math.max(1, displayLines[1].length - 1))}…`;
  }

  const baseY = displayLines.length === 1 ? size * 0.68 : size * 0.63;
  displayLines.forEach((line, idx) => {
    ctx.fillText(line, size / 2, baseY + idx * (fontSize + 8), iw - 28);
  });

  ctx.restore();

  const webp = canvas.toDataURL('image/webp', 0.88);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
