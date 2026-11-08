// Сервис постов: создание/редактирование/удаление всех семи типов,
// черновики, теги, сборка данных для отображения.
// Поле post_media.position хранит порядок файлов внутри поста.
import { renderMarkdown, renderPlain, isSafeLinkUrl } from './render.js';
import { processUpload } from '../media/validate.js';
import { readTmpFile, cleanupTmp } from '../media/multer.js';
import { getUploadLimits } from '../../db/settings.js';
import { syncPost } from '../search/service.js';
import { notify } from '../notifications/service.js';
import { canInteract } from '../moderation/service.js';

export class FormError extends Error {
  constructor(code, { status = 422 } = {}) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const POST_TYPES = ['text', 'photo', 'quote', 'link', 'audio', 'video', 'gif'];

const LIMITS = {
  title: 200,
  body: 50_000,
  caption: 10_000,
  quote: 5_000,
  source: 300,
  description: 2_000,
  url: 2048,
};

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function required(value, code, max) {
  const s = str(value);
  if (!s) throw new FormError(code);
  if (s.length > max) throw new FormError('composer.errors.too_long');
  return s;
}

function optional(value, max) {
  const s = str(value);
  if (s.length > max) throw new FormError('composer.errors.too_long');
  return s || null;
}

function nsfwFlag(value) {
  return value === 'on' || value === '1' || value === true ? 1 : 0;
}

// Теги: нормализация, до 10 штук по 30 символов.
export function parseTags(input) {
  if (!input) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(input).split(',')) {
    let tag = raw.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > 30) tag = tag.slice(0, 30);
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
    if (out.length >= 10) break;
  }
  return out;
}

function filesByName(files, name) {
  return (files ?? []).filter((f) => f.fieldname === name);
}

// Текстовые поля по типу поста + санитизированный HTML для отображения.
function buildFields(type, input) {
  switch (type) {
    case 'text': {
      const title = optional(input.title, LIMITS.title);
      const body = required(input.body, 'composer.errors.required_text', LIMITS.body);
      return { title, body, body_html: renderMarkdown(body), quote_text: null, link_url: null };
    }
    case 'photo':
    case 'gif': {
      const caption = optional(input.body, LIMITS.caption);
      return { title: null, body: caption, body_html: caption ? renderMarkdown(caption) : '', quote_text: null, link_url: null };
    }
    case 'quote': {
      const quote = required(input.quote, 'composer.errors.required_quote', LIMITS.quote);
      const source = optional(input.source, LIMITS.source);
      return { title: null, body: source, body_html: '', quote_text: quote, link_url: null };
    }
    case 'link': {
      const url = required(input.url, 'composer.errors.required_url', LIMITS.url);
      if (!isSafeLinkUrl(url)) throw new FormError('composer.errors.bad_url');
      const title = optional(input.title, LIMITS.title);
      const description = optional(input.description, LIMITS.description);
      return { title, body: description, body_html: renderPlain(description), quote_text: null, link_url: url };
    }
    case 'audio':
    case 'video': {
      const title = optional(input.title, LIMITS.title);
      const caption = optional(input.body, LIMITS.caption);
      return { title, body: caption, body_html: caption ? renderMarkdown(caption) : '', quote_text: null, link_url: null };
    }
    default:
      throw new FormError('composer.errors.required_text');
  }
}

// Создание поста (публикация или черновик). Файлы уже во временном каталоге multer.
export async function createPost(ctx, blog, input, files, action) {
  const type = POST_TYPES.includes(input.type) ? input.type : null;
  if (!type) throw new FormError('composer.errors.required_text');

  const limits = getUploadLimits(ctx.db);
  let status = action === 'draft' ? 'draft' : 'published';
  if (action === 'queue') status = 'queued';
  if (action === 'schedule') status = 'scheduled';
  const now = Date.now();
  const fields = buildFields(type, input);
  const tags = parseTags(input.tags);
  const nsfw = nsfwFlag(input.nsfw);

  const savedKeys = [];
  const mediaRows = [];

  try {
    const handle = async (file, purpose) => {
      const buffer = await readTmpFile(file);
      const processed = await processUpload(buffer, purpose, limits);
      const storageKey = await ctx.storage.save(processed.buffer);
      savedKeys.push(storageKey);
      mediaRows.push({
        owner_blog_id: blog.id,
        kind: processed.kind,
        storage_key: storageKey,
        mime_type: processed.mime,
        size: processed.buffer.byteLength,
        width: processed.width,
        height: processed.height,
        created_at: now,
      });
    };

    if (type === 'photo') {
      const list = filesByName(files, 'media');
      if (list.length === 0) throw new FormError('composer.errors.required_file');
      if (list.length > limits.maxFilesPerPost) throw new FormError('composer.errors.too_many_files');
      for (const file of list) await handle(file, 'image');
    } else if (type === 'gif') {
      const list = filesByName(files, 'file');
      if (list.length === 0) throw new FormError('composer.errors.required_file');
      await handle(list[0], 'gif');
    } else if (type === 'audio') {
      const list = filesByName(files, 'file');
      if (list.length === 0) throw new FormError('composer.errors.required_file');
      await handle(list[0], 'audio');
      const cover = filesByName(files, 'cover')[0];
      if (cover) await handle(cover, 'cover');
    } else if (type === 'video') {
      const list = filesByName(files, 'file');
      if (list.length === 0) throw new FormError('composer.errors.required_file');
      await handle(list[0], 'video');
    } else if (type === 'text' || type === 'quote' || type === 'link') {
      const stray = filesByName(files, 'media').length + filesByName(files, 'file').length;
      if (stray > 0) throw new FormError('composer.errors.bad_media');
    }

    const scheduledAt = action === 'schedule' ? Number(input.scheduled_at_utc) : null;
    const queuedAt = action === 'queue' ? now : null;
    const post = ctx.db.transaction(() => insertPost(ctx, blog.id, { type, ...fields, status, nsfw, now, scheduledAt, queuedAt }, mediaRows, tags))();
    if (status !== 'scheduled' && status !== 'queued') syncPost(ctx.db, post.id);
    return post;
  } catch (err) {
    // Уже сохранённые в хранилище файлы откатываем; временные чистим в любом случае.
    await Promise.all(savedKeys.map((key) => ctx.storage.remove(key)));
    throw err;
  } finally {
    await cleanupTmp(files);
  }
}

function insertPost(ctx, blogId, { type, title, body, body_html, quote_text, link_url, status, nsfw, now, scheduledAt = null, queuedAt = null }, mediaRows, tags) {
  const info = ctx.db
    .prepare(
      `INSERT INTO posts
        (blog_id, type, title, body, body_html, quote_text, link_url, status, nsfw,
         published_at, scheduled_at, queued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      blogId,
      type,
      title,
      body,
      body_html,
      quote_text,
      link_url,
      status,
      nsfw,
      status === 'published' ? now : null,
      scheduledAt,
      queuedAt,
      now,
      now
    );
  const postId = info.lastInsertRowid;

  mediaRows.forEach((m, position) => {
    const mediaInfo = ctx.db
      .prepare(
        `INSERT INTO media (owner_blog_id, kind, storage_key, mime_type, size, width, height, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`
      )
      .run(m.owner_blog_id, m.kind, m.storage_key, m.mime_type, m.size, m.width, m.height, m.created_at);
    ctx.db.prepare('INSERT INTO post_media (post_id, media_id, position) VALUES (?, ?, ?)').run(postId, mediaInfo.lastInsertRowid, position);
  });

  for (const tag of tags) {
    ctx.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tag);
    const row = ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
    ctx.db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(postId, row.id);
  }

  return ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
}

// Редактирование текстовых полей/тегов/NSFW; черновик можно опубликовать.
// Замена медиафайлов не поддерживается (MVP): для этого пост удаляют и создают заново.
export function updatePost(ctx, blog, postId, input, publishNow = false) {
  const post = getPostForBlog(ctx.db, postId, blog.id);
  if (!post) throw new FormError('blog.not_found', { status: 404 });

  const fields = buildFields(post.type, {
    title: input.title,
    body: input.body,
    quote: input.quote ?? post.quote_text,
    source: input.source,
    url: input.url ?? post.link_url,
    description: input.description,
  });

  const status = publishNow && post.status === 'draft' ? 'published' : post.status;
  const publishedAt = status === 'published' ? post.published_at ?? Date.now() : post.published_at;
  const tags = parseTags(input.tags);
  const now = Date.now();

  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `UPDATE posts SET title = ?, body = ?, body_html = ?, quote_text = ?, link_url = ?,
         status = ?, nsfw = ?, published_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(fields.title, fields.body, fields.body_html, fields.quote_text, fields.link_url, status, nsfwFlag(input.nsfw), publishedAt, now, postId);
    ctx.db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId);
    for (const tag of tags) {
      ctx.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tag);
      const row = ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
      ctx.db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(postId, row.id);
    }
  })();
  syncPost(ctx.db, postId);
  return ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
}

// Мягкое удаление: пост скрывается, запись остаётся (реблоги и целостность цепочек — этап 5).
export function deletePost(ctx, blog, postId) {
  const post = getPostForBlog(ctx.db, postId, blog.id);
  if (!post) throw new FormError('blog.not_found', { status: 404 });
  ctx.db.prepare("UPDATE posts SET status = 'deleted', updated_at = ? WHERE id = ?").run(Date.now(), postId);
  syncPost(ctx.db, postId);
}

function getPostForBlog(db, postId, blogId) {
  const id = Number(postId);
  if (!Number.isInteger(id)) return null;
  return db.prepare('SELECT * FROM posts WHERE id = ? AND blog_id = ?').get(id, blogId);
}

// ---------- Выборки для отображения ----------

export const POST_JOIN = `
  SELECT p.*, b.slug AS blog_slug, b.title AS blog_title, u.id AS author_user_id,
         am.storage_key AS blog_avatar_key
  FROM posts p
  JOIN blogs b ON b.id = p.blog_id
  JOIN users u ON u.id = b.user_id
  LEFT JOIN media am ON am.id = b.avatar_media_id
`;

export function listBlogPosts(db, blogId, status, { page = 1, perPage = 10, byUpdated = false }) {
  const offset = (page - 1) * perPage;
  const order = byUpdated ? 'p.updated_at DESC' : 'p.published_at DESC, p.id DESC';
  const rows = db
    .prepare(`${POST_JOIN} WHERE p.blog_id = ? AND p.status = ? ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(blogId, status, perPage, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE blog_id = ? AND status = ?').get(blogId, status).n;
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export function getPostById(db, postId) {
  const id = Number(postId);
  if (!Number.isInteger(id)) return null;
  return db.prepare(`${POST_JOIN} WHERE p.id = ?`).get(id);
}

// Декорация постов для отображения: медиа, теги, лайк-состояние зрителя,
// комментарии и цепочка реблога (промежуточные авторы + корень).
// Два-три запроса IN вместо N+1; глубина цепочки ограничена.
const MAX_TRAIL = 6; // показываем не более 5 промежуточных уровней, остальные — счётчиком

export function decoratePosts(db, posts, viewer = null) {
  const rootIds = posts.filter((p) => p.reblog_root_id).map((p) => p.reblog_root_id);
  const ids = posts.map((p) => p.id);
  const allIds = [...new Set([...ids, ...rootIds])];

  const mediaMap = new Map();
  const tagsMap = new Map();
  if (allIds.length > 0) {
    const ph = allIds.map(() => '?').join(',');
    const mediaRows = db
      .prepare(
        `SELECT pm.post_id, m.kind, m.storage_key, m.mime_type, m.width, m.height
         FROM post_media pm JOIN media m ON m.id = pm.media_id
         WHERE pm.post_id IN (${ph}) ORDER BY pm.position`
      )
      .all(...allIds);
    for (const row of mediaRows) {
      if (!mediaMap.has(row.post_id)) mediaMap.set(row.post_id, []);
      mediaMap.get(row.post_id).push(row);
    }
    const tagRows = db
      .prepare(`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id IN (${ph})`)
      .all(...allIds);
    for (const row of tagRows) {
      if (!tagsMap.has(row.post_id)) tagsMap.set(row.post_id, []);
      tagsMap.get(row.post_id).push(row.name);
    }
  }

  // Лайки зрителя — для активного состояния кнопки.
  const likedSet = new Set();
  if (viewer?.userId && ids.length > 0) {
    const ph = ids.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${ph})`).all(viewer.userId, ...ids)) {
      likedSet.add(row.post_id);
    }
  }

  // Комментарии (видимые) с автором-блогом.
  const commentsMap = new Map();
  if (ids.length > 0) {
    const ph = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT c.id, c.post_id, c.body, c.created_at, b.slug AS blog_slug, b.title AS blog_title,
                am.storage_key AS avatar_key, c.user_id
         FROM comments c
         JOIN blogs b ON b.user_id = c.user_id
         LEFT JOIN media am ON am.id = b.avatar_media_id
         WHERE c.post_id IN (${ph}) AND c.status = 'visible'
         ORDER BY c.created_at ASC`
      )
      .all(...ids);
    for (const row of rows) {
      if (!commentsMap.has(row.post_id)) commentsMap.set(row.post_id, []);
      commentsMap.get(row.post_id).push(row);
    }
  }

  // Цепочки реблогов: корень + промежуточные авторы.
  const trailMap = new Map(); // post_id -> { root: decoratedRoot, parents: [...], more: n }
  const reblogPosts = posts.filter((p) => p.reblog_root_id);
  if (reblogPosts.length > 0) {
    const roots = db
      .prepare(`${POST_JOIN} WHERE p.id IN (${reblogPosts.map(() => '?').join(',')})`)
      .all(...new Set(reblogPosts.map((p) => p.reblog_root_id)));
    const rootById = new Map(roots.map((r) => [r.id, r]));
    for (const p of reblogPosts) {
      const root = rootById.get(p.reblog_root_id);
      if (!root) continue;
      // Промежуточные: от прямого родителя вверх до корня.
      const parents = [];
      let cur = p.reblog_parent_id;
      while (cur && cur !== root.id && parents.length < MAX_TRAIL) {
        const row = db.prepare(`${POST_JOIN} WHERE p.id = ?`).get(cur);
        if (!row) break;
        parents.push({
          id: row.id,
          blog_slug: row.blog_slug,
          blog_title: row.blog_title,
          body_html: row.body_html,
          status: row.status,
        });
        cur = row.reblog_parent_id;
      }
      // cur !== root.id означает, что цепочка длиннее MAX_TRAIL — досчитать оставшиеся уровни.
      let more = 0;
      let hop = cur;
      while (hop && hop !== root.id && more < 1000) {
        const row = db.prepare('SELECT reblog_parent_id FROM posts WHERE id = ?').get(hop);
        if (!row) break;
        hop = row.reblog_parent_id;
        more += 1;
      }
      const decoratedRoot = { ...root, media: mediaMap.get(root.id) ?? [], tags: tagsMap.get(root.id) ?? [] };
      trailMap.set(p.id, { root: decoratedRoot, parents: parents.reverse(), more });
    }
  }

  return posts.map((p) => ({
    ...p,
    media: mediaMap.get(p.id) ?? [],
    tags: tagsMap.get(p.id) ?? [],
    likedByMe: likedSet.has(p.id),
    comments: commentsMap.get(p.id) ?? [],
    reblog: trailMap.get(p.id) ?? null,
  }));
}

// Лента дашборда: свои посты + посты подписанных блогов, строго хронологически.
export function listFeedPosts(db, userId, blogId, { page = 1, perPage = 10 }) {
  const offset = (page - 1) * perPage;
  const rows = db
    .prepare(
      `${POST_JOIN}
       WHERE p.status = 'published' AND (p.blog_id = ? OR p.blog_id IN
         (SELECT blog_id FROM follows WHERE user_id = ?))
       ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .all(blogId, userId, perPage, offset);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts p
       WHERE p.status = 'published' AND (p.blog_id = ? OR p.blog_id IN
         (SELECT blog_id FROM follows WHERE user_id = ?))`
    )
    .get(blogId, userId).n;
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

// Реблог: новая строка posts со ссылкой на корень и прямого родителя (ADR-019).
export function createReblog(ctx, root, rebloggerBlog, input) {
  if (root.status !== 'published') throw new FormError('social.reblog_not_published', { status: 422 });
  if (!canInteract(ctx.db, rebloggerBlog.user_id, root.author_user_id)) {
    throw new FormError('social.blocked', { status: 403 });
  }
  const addedText = optional(input.body, LIMITS.body);
  const tags = parseTags(input.tags);
  const now = Date.now();
  const rootId = root.reblog_root_id ?? root.id;

  const post = ctx.db.transaction(() => {
    const info = ctx.db
      .prepare(
        `INSERT INTO posts
          (blog_id, type, title, body, body_html, quote_text, link_url, status, nsfw,
           reblog_root_id, reblog_parent_id, published_at, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, NULL, NULL, 'published', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rebloggerBlog.id,
        root.type,
        addedText,
        addedText ? renderMarkdown(addedText) : '',
        root.nsfw ? 1 : nsfwFlag(input.nsfw),
        rootId,
        root.id,
        now,
        now,
        now
      );
    ctx.db.prepare('UPDATE posts SET reblog_count = reblog_count + 1 WHERE id = ?').run(rootId);
    const rootAuthor = ctx.db
      .prepare('SELECT u.id AS author_id FROM posts p JOIN blogs b ON b.id = p.blog_id JOIN users u ON u.id = b.user_id WHERE p.id = ?')
      .get(rootId);
    if (rootAuthor) {
      notify(ctx.db, { userId: rootAuthor.author_id, type: 'reblog', actorUserId: rebloggerBlog.user_id, postId: rootId });
    }
    for (const tag of tags) {
      ctx.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tag);
      const row = ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
      ctx.db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(info.lastInsertRowid, row.id);
    }
    const created = ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
    syncPost(ctx.db, created.id);
    return created;
  })();
  return post;
}
