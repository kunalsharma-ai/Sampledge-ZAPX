/** Small sRGB colour helpers: parsing, mixing and WCAG 2.2 contrast. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

export function parseHex(value: string): Rgb {
  const m = HEX.exec(value.trim());
  if (!m) throw new Error(`Not a hex colour: ${value}`);
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `amount` 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  const t = Math.min(1, Math.max(0, amount));
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** `rgb(r g b / alpha)` for translucent surfaces. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `rgb(${r} ${g} ${b} / ${a})`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Moves `fg` towards black or white (whichever direction increases contrast with every colour in
 * `against`) in small steps until it reaches `ratio`. Returns the first colour that passes, so the
 * hue stays as close to the original as possible.
 */
export function ensureContrast(fg: string, against: string[], ratio: number): string {
  const passes = (c: string) => against.every((bg) => contrast(c, bg) >= ratio);
  if (passes(fg)) return fg;
  const darkBg = against.reduce((s, bg) => s + luminance(bg), 0) / against.length < 0.18;
  const target = darkBg ? '#ffffff' : '#000000';
  for (let step = 1; step <= 40; step++) {
    const c = mix(fg, target, step / 40);
    if (passes(c)) return c;
  }
  return target;
}

/** White or near-black text, whichever reads better on `bg`. */
export function readableOn(bg: string, dark = '#0b0d12'): string {
  return contrast('#ffffff', bg) >= contrast(dark, bg) ? '#ffffff' : dark;
}
