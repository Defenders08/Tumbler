// Тема публичного блога: цвета и шрифт. Хранится в blogs.theme как JSON.
// Пользовательский CSS и тайловый фон — отдельный этап, сейчас только безопасные поля.
export const DEFAULT_THEME = {
  accentColor: '#2f9dd6',
  bannerKey: null,
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
  if (typeof parsed.accentColor === 'string' && HEX.test(parsed.accentColor)) {
    base.accentColor = parsed.accentColor.toLowerCase();
  }
  if (typeof parsed.bannerKey === 'string' && /^[0-9a-f]{32}$/.test(parsed.bannerKey)) {
    base.bannerKey = parsed.bannerKey;
  }
  return base;
}

export function validateTheme(input) {
  const theme = { ...DEFAULT_THEME };
  if (typeof input.accentColor === 'string' && HEX.test(input.accentColor)) {
    theme.accentColor = input.accentColor.toLowerCase();
  }
  if (typeof input.bannerKey === 'string' && /^[0-9a-f]{32}$/.test(input.bannerKey)) {
    theme.bannerKey = input.bannerKey;
  }
  return theme;
}


