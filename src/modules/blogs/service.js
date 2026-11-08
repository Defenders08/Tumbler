// Сервис блогов: поиск, обновление профиля и темы, аватар.
import { parseTheme, validateTheme } from './theme.js';
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
  return { ...blog, theme: parseTheme(blog.theme) };
}

export function updateProfile(db, blogId, { title, description }) {
  db.prepare('UPDATE blogs SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(
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
