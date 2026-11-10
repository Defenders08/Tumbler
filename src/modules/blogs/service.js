// Сервис блогов: поиск, обновление профиля и темы, аватар.
import { parseTheme, validateTheme } from './theme.js';
import { effectiveHue, tintShift, dominantHue } from '../../lib/colors.js';

// Дополняет тему готовым сдвигом палитры для CSS (--tint-shift).
export function withTint(theme) {
  const shift = tintShift(effectiveHue(theme));
  if (shift != null) theme.tintShift = shift;
  return theme;
}
import { syncBlog } from '../search/service.js';

export function getBlogBySlug(db, slug) {
  return db.prepare('SELECT * FROM blogs WHERE slug = ?').get(slug);
}

export function getBlogByUserId(db, userId) {
  return db.prepare('SELECT * FROM blogs WHERE user_id = ?').get(userId);
}

// Блог + аватар (media) одной выборкой для страниц блога и настроек.
export function getBlogView(db, slug) {
  const blog = db
    .prepare(
      `SELECT b.*, m.storage_key AS avatar_key, m.mime_type AS avatar_mime
       FROM blogs b LEFT JOIN media m ON m.id = b.avatar_media_id
       WHERE b.slug = ?`
    )
    .get(slug);
  if (!blog) return null;
  const theme = parseTheme(blog.theme);
  // Битый ключ фона (записи в media нет) не подключаем — иначе браузер получит 404-картинку.
  if (theme.backgroundKey && !db.prepare('SELECT 1 AS ok FROM media WHERE storage_key = ?').get(theme.backgroundKey)) {
    theme.backgroundKey = null;
  }
  // Перекраска интерфейса по оттенку фоновой картинки или выбранному цвету.
  withTint(theme);
  return { ...blog, theme };
}

export function updateProfile(db, blogId, { title, description }) {  db.prepare('UPDATE blogs SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(
    title,
    description ?? '',
    Date.now(),
    blogId
  );
  syncBlog(db, blogId);
}

export function updateTheme(db, blogId, rawThemeInput) {
  const theme = validateTheme(rawThemeInput);
  db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(theme),
    Date.now(),
    blogId
  );
  return theme;
}

export function resetTheme(db, blogId) {
  db.prepare("UPDATE blogs SET theme = '{}', updated_at = ? WHERE id = ?").run(Date.now(), blogId);
}

export function setAvatar(db, blogId, mediaId) {
  db.prepare('UPDATE blogs SET avatar_media_id = ?, updated_at = ? WHERE id = ?').run(
    mediaId,
    Date.now(),
    blogId
  );
}

// Догон для фонов, загруженных до появления перекраски: считаем оттенок
// из файла один раз при старте и сохраняем в тему блога.
export async function backfillBackgroundHues(ctx) {
  const rows = ctx.db.prepare("SELECT id, theme FROM blogs WHERE theme LIKE '%backgroundKey%'").all();
  for (const row of rows) {
    const theme = parseTheme(row.theme);
    if (!theme.backgroundKey || theme.backgroundHue != null) continue;
    const fullPath = ctx.storage.resolvePath(theme.backgroundKey);
    if (!fullPath) continue;
    try {
      const hue = await dominantHue(fullPath);
      if (hue == null) continue;
      const next = { ...theme, backgroundHue: hue };
      ctx.db.prepare('UPDATE blogs SET theme = ? WHERE id = ?').run(JSON.stringify(next), row.id);
    } catch {
      // файла нет или картинка битая — остаёмся на стандартной синей палитре
    }
  }
}
