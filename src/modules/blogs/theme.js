// Тема публичного блога: цвета и шрифт. Хранится в blogs.theme как JSON.
// Пользовательский CSS и тайловый фон — отдельный этап, сейчас только безопасные поля.
export const DEFAULT_THEME = {
  bgColor: '#f2f4f7',
  accentColor: '#2f9dd6',
  textColor: '#444444',
  font: 'helvetica',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONTS = ['helvetica', 'georgia', 'courier'];

export function parseTheme(raw) {
  const base = { ...DEFAULT_THEME };
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== 'object') return base;
  for (const key of ['bgColor', 'accentColor', 'textColor']) {
    if (typeof parsed[key] === 'string' && HEX.test(parsed[key])) {
      base[key] = parsed[key].toLowerCase();
    }
  }
  if (FONTS.includes(parsed.font)) base.font = parsed.font;
  return base;
}

export function validateTheme(input) {
  const theme = {};
  for (const key of ['bgColor', 'accentColor', 'textColor']) {
    const value = input[key];
    theme[key] = typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : DEFAULT_THEME[key];
  }
  theme.font = FONTS.includes(input.font) ? input.font : DEFAULT_THEME.font;
  return theme;
}

export const FONT_STACKS = {
  helvetica: `"Helvetica Neue", Helvetica, Arial, sans-serif`,
  georgia: `Georgia, "Times New Roman", serif`,
  courier: `"Courier New", Courier, monospace`,
};
