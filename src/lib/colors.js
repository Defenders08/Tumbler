// Цвета кастомного фона блога: доминирующий оттенок картинки и сдвиг палитры.
// Сама палитра живёт в CSS (body.has-blog-tint) и считается от --tint-shift,
// поэтому «живое» перекрашивание — это изменение одной переменной.
import sharp from 'sharp';

// Базовый оттенок синей палитры Tumbler (см. первую цифру в токенах body.has-blog-tint).
export const UI_HUE = 213;

const norm = (hue) => ((Math.round(hue) % 360) + 360) % 360;

/**
 * Доминирующий оттенок картинки (0–359) или null, если она почти серая.
 * Гистограмма по 5°, вес пикселя — насыщенность; берём пик и соседние бины,
 * чтобы не прыгать между двумя близкими оттенками.
 */
export async function dominantHue(input) {
  const { data, info } = await sharp(input)
    .resize(48, 48, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bins = new Array(72).fill(0);
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l < 0.12 || l > 0.9) continue;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.15) continue;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    bins[Math.floor(norm(h * 60) / 5) % 72] += s;
  }

  if (bins.reduce((a, b) => a + b, 0) < 8) return null;

  let peak = 0;
  for (let i = 1; i < 72; i += 1) if (bins[i] > bins[peak]) peak = i;

  let x = 0;
  let y = 0;
  for (let k = -2; k <= 2; k += 1) {
    const idx = (peak + k + 72) % 72;
    const w = bins[idx];
    if (!w) continue;
    const angle = ((idx * 5 + 2.5) * Math.PI) / 180;
    x += Math.cos(angle) * w;
    y += Math.sin(angle) * w;
  }
  if (x === 0 && y === 0) return peak * 5;
  return norm((Math.atan2(y, x) * 180) / Math.PI);
}

// Оттенок выбранного пользователем цвета (#rrggbb) или null для серого.
export function hexToHue(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return null;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return norm(h * 60);
}

/**
 * Итоговый оттенок интерфейса блога:
 *   auto   — оттенок фоновой картинки (нет картинки — не красим);
 *   custom — выбранный пользователем цвет;
 *   off    — стандартная синяя палитра.
 */
export function effectiveHue(theme) {
  if (!theme) return null;
  if (theme.tintMode === 'off') return null;
  if (theme.tintMode === 'custom') return hexToHue(theme.tintColor);
  return Number.isInteger(theme.backgroundHue) ? theme.backgroundHue : null;
}

// Сдвиг по кругу относительно базового синего; в пределах ±180°, чтобы не копить обороты.
export function tintShift(hue) {
  if (!Number.isInteger(hue)) return null;
  return ((hue - UI_HUE + 540) % 360) - 180;
}
