// Тема публичного блога: акцентный цвет, кастомный фон и соцсети в шапке.
// Хранится в blogs.theme как JSON. Пользовательский CSS — отдельный этап,
// сейчас только безопасные поля.
import { sanitizeSocials } from './socials.js';

export const DEFAULT_THEME = {
  accentColor: '#2f9dd6',
  backgroundKey: null,
  // Оттенок фоновой картинки (0–359): по нему красится интерфейс страницы блога.
  backgroundHue: null,
  // Перекраска интерфейса: auto — по картинке, custom — свой цвет, off — стандартная синяя.
  tintMode: 'auto',
  tintColor: '#2f9dd6',
  // Соцсети в шапке блога: [{ network, label, url }].
  socials: [],
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const KEY = /^[0-9a-f]{32}$/;
const TINT_MODES = ['auto', 'custom', 'off'];

export function parseTheme(raw) {
  const base = { ...DEFAULT_THEME };
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== 'object') return base;
  if (typeof parsed.accentColor === 'string' && HEX.test(parsed.accentColor)) {
    base.accentColor = parsed.accentColor.toLowerCase();
  }
  // bannerKey — старое имя ключа шапки; читаем его, пока в базе не прошла миграция 011.
  const background = parsed.backgroundKey ?? parsed.bannerKey;
  if (typeof background === 'string' && KEY.test(background)) {
    base.backgroundKey = background;
  }
  if (Number.isInteger(parsed.backgroundHue) && parsed.backgroundHue >= 0 && parsed.backgroundHue < 360) {
    base.backgroundHue = parsed.backgroundHue;
  }
  if (TINT_MODES.includes(parsed.tintMode)) base.tintMode = parsed.tintMode;
  if (typeof parsed.tintColor === 'string' && HEX.test(parsed.tintColor)) {
    base.tintColor = parsed.tintColor.toLowerCase();
  }
  base.socials = sanitizeSocials(parsed.socials);
  return base;
}

export function validateTheme(input) {
  const theme = { ...DEFAULT_THEME };
  if (typeof input.accentColor === 'string' && HEX.test(input.accentColor)) {
    theme.accentColor = input.accentColor.toLowerCase();
  }
  if (typeof input.backgroundKey === 'string' && KEY.test(input.backgroundKey)) {
    theme.backgroundKey = input.backgroundKey;
  }
  if (Number.isInteger(input.backgroundHue) && input.backgroundHue >= 0 && input.backgroundHue < 360) {
    theme.backgroundHue = input.backgroundHue;
  }
  if (TINT_MODES.includes(input.tintMode)) theme.tintMode = input.tintMode;
  if (typeof input.tintColor === 'string' && HEX.test(input.tintColor)) {
    theme.tintColor = input.tintColor.toLowerCase();
  }
  theme.socials = sanitizeSocials(input.socials);
  return theme;
}
