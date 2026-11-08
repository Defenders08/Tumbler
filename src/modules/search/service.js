// Поиск: FTS5 (unicode61) + префиксные запросы + LIKE-фолбэк (ADR-010).
// Индекс синхронизируется из кода: syncPost/syncBlog вызываются при изменениях,
// removePost/removeBlog — при удалении. Русские словоформы — осознанное ограничение:
// терм усекается до префикса, короткие запросы уходят в LIKE.
import { POST_JOIN } from '../posts/service.js';

const MIN_FTS_TERM = 3;
const PREFIX_CUT = 6; // усечение терма для префиксного поиска словоформ

// ---------- Индексация ----------

export function syncPost(db, postId) {
  const post = db
    .prepare(
      `SELECT p.title, p.body, p.quote_text, p.link_url, p.status, GROUP_CONCAT(t.name, ' ') AS tags
       FROM posts p
       LEFT JOIN post_tags pt ON pt.post_id = p.id
       LEFT JOIN tags t ON t.id = pt.tag_id
       WHERE p.id = ?
       GROUP BY p.id`
    )
    .get(postId);
  if (!post) return removePost(db, postId);
  db.prepare('DELETE FROM posts_fts WHERE post_id = ?').run(postId);
  const text = [post.title, post.quote_text, post.link_url, post.body, post.tags]
    .filter(Boolean)
    .join('\n');
  if (post.status === 'published' && text.trim()) {
    db.prepare('INSERT INTO posts_fts (text, post_id) VALUES (?, ?)').run(text, postId);
  }
}

export function removePost(db, postId) {
  db.prepare('DELETE FROM posts_fts WHERE post_id = ?').run(postId);
}

export function syncBlog(db, blogId) {
  const blog = db.prepare('SELECT slug, title, description FROM blogs WHERE id = ?').get(blogId);
  if (!blog) return removeBlog(db, blogId);
  db.prepare('DELETE FROM blogs_fts WHERE blog_id = ?').run(blogId);
  const text = [blog.slug, blog.title, blog.description].filter(Boolean).join('\n');
  if (text.trim()) {
    db.prepare('INSERT INTO blogs_fts (text, blog_id) VALUES (?, ?)').run(text, blogId);
  }
}

export function removeBlog(db, blogId) {
  db.prepare('DELETE FROM blogs_fts WHERE blog_id = ?').run(blogId);
}

// ---------- Разбор запроса ----------

export function parseQuery(q) {
  const raw = String(q ?? '').trim().slice(0, 100);
  if (!raw) return { fts: null, likeTerms: [], hasLikeQuery: false };
  const terms = raw
    .split(/\s+/)
    .map((t) => t.replace(/["'*()]/g, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const ftsTerms = [];
  const likeTerms = [];
  for (const term of terms) {
    if (term.length >= MIN_FTS_TERM) {
      // Префикс усечённого терма: покрывает русские словоформы («пост» найдёт «поста/посту»).
      const stem = term.slice(0, PREFIX_CUT).replace(/["*]/g, '');
      if (stem.length >= 2) ftsTerms.push(`"${stem}"*`);
    } else {
      likeTerms.push(term.toLowerCase());
    }
  }
  return {
    fts: ftsTerms.length > 0 ? ftsTerms.join(' ') : null,
    likeTerms,
    hasLikeQuery: likeTerms.length > 0,
  };
}

function likeEscape(value) {
  return value.replace(/[\\%_]/g, (c) => '\\' + c);
}

// ---------- Поиск постов ----------

export function searchPosts(db, query, { type = null, page = 1, perPage = 10 } = {}) {
  const { fts, likeTerms } = parseQuery(query);
  if (!fts && likeTerms.length === 0) return { rows: [], total: 0, page, perPage, pages: 1 };

  const offset = (page - 1) * perPage;
  let rows = [];
  let total = 0;

  if (fts) {
    const typeCond = type ? 'AND p.type = ?' : '';
    const args = type ? [type] : [];
    try {
      const base = `${POST_JOIN} JOIN posts_fts f ON f.post_id = p.id
                    WHERE p.status = 'published' AND posts_fts MATCH ? ${typeCond}`;
      rows = db
        .prepare(`${base} ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`)
        .all(fts, ...args, perPage, offset);
      total = db
        .prepare(`SELECT COUNT(*) AS n FROM posts p JOIN posts_fts f ON f.post_id = p.id
                  WHERE p.status = 'published' AND posts_fts MATCH ? ${typeCond}`)
        .get(fts, ...args).n;
      return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
    } catch {
      // Некорректный MATCH-запрос — падаем в LIKE.
    }
  }

  // LIKE-фолбэк: короткие термы или сбой FTS.
  const conds = [];
  const args = [];
  for (const term of likeTerms) {
    const like = `%${likeEscape(term)}%`;
    conds.push("(lower(p.title) LIKE ? ESCAPE '\\' OR lower(p.body) LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  if (fts) {
    // FTS дал 0 строк — LIKE по исходному запросу как страховка для морфологии.
    conds.push("(lower(p.title) LIKE ? ESCAPE '\\' OR lower(p.body) LIKE ? ESCAPE '\\')");
    const stem = query.trim().toLowerCase().slice(0, 30);
    args.push(`%${likeEscape(stem)}%`, `%${likeEscape(stem)}%`);
  }
  if (type) {
    conds.push('p.type = ?');
    args.push(type);
  }
  const where = conds.length > 0 ? `AND ${conds.join(' AND ')}` : '';
  rows = db
    .prepare(
      `${POST_JOIN} WHERE p.status = 'published' ${where}
       ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, perPage, offset);
  total = db
    .prepare(`SELECT COUNT(*) AS n FROM posts p WHERE p.status = 'published' ${where}`)
    .get(...args).n;
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

// ---------- Поиск блогов ----------

export function searchBlogs(db, query, { limit = 10 } = {}) {
  const { fts, likeTerms } = parseQuery(query);
  if (!fts && likeTerms.length === 0) return [];

  let rows = [];
  if (fts) {
    try {
      rows = db
        .prepare(
          `SELECT b.slug, b.title, b.description, am.storage_key AS avatar_key
           FROM blogs b
           JOIN blogs_fts f ON f.blog_id = b.id
           LEFT JOIN media am ON am.id = b.avatar_media_id
           JOIN users u ON u.id = b.user_id AND u.status = 'active'
           WHERE blogs_fts MATCH ?
           ORDER BY b.title LIMIT ?`
        )
        .all(fts, limit);
      if (rows.length > 0) return rows;
    } catch {
      // фолбэк ниже
    }
  }
  const conds = [];
  const args = [];
  const terms = likeTerms.length > 0 ? likeTerms : [String(query ?? '').toLowerCase().slice(0, 30)];
  for (const term of terms) {
    const like = `%${likeEscape(term)}%`;
    conds.push("(lower(b.title) LIKE ? ESCAPE '\\' OR lower(b.slug) LIKE ? ESCAPE '\\' OR lower(b.description) LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  rows = db
    .prepare(
      `SELECT b.slug, b.title, b.description, am.storage_key AS avatar_key
       FROM blogs b
       LEFT JOIN media am ON am.id = b.avatar_media_id
       JOIN users u ON u.id = b.user_id AND u.status = 'active'
       WHERE ${conds.join(' AND ')}
       ORDER BY b.title LIMIT ?`
    )
    .all(...args, limit);
  return rows;
}

// ---------- Поиск тегов ----------

export function searchTags(db, query, { limit = 10 } = {}) {
  const term = likeEscape(String(query ?? '').trim().toLowerCase().slice(0, 30));
  if (!term) return [];
  return db
    .prepare(
      `SELECT t.name, COUNT(pt.post_id) AS post_count
       FROM tags t
       JOIN post_tags pt ON pt.tag_id = t.id
       JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
       WHERE t.name LIKE ? ESCAPE '\\'
       GROUP BY t.id
       ORDER BY post_count DESC, t.name
       LIMIT ?`
    )
    .all(`%${term}%`, limit);
}

// ---------- Посты по тегу ----------

export function postsByTag(db, tagName, { page = 1, perPage = 10 } = {}) {
  const name = String(tagName ?? '').trim().toLowerCase();
  const offset = (page - 1) * perPage;
  const rows = db
    .prepare(
      `${POST_JOIN}
       WHERE p.status = 'published'
         AND p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)
       ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .all(name, perPage, offset);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts p
       WHERE p.status = 'published'
         AND p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)`
    )
    .get(name).n;
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

// ---------- Поиск по одному тегу (существование) ----------

export function tagExists(db, tagName) {
  return Boolean(db.prepare('SELECT id FROM tags WHERE name = ?').get(String(tagName ?? '').toLowerCase()));
}
