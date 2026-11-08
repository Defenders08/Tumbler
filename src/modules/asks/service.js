// Ask box (Этап 6): вопросы блогу, ответы постом, игнор/удаление.
// Анонимные вопросы — по ADR-018: включаются владельцем, ограничение частоты (лимитер в маршруте),
// ответ на анонимный вопрос — только публичный пост (у нас любой ответ — публичный пост).
import { renderMarkdown } from '../posts/render.js';
import { notify } from '../notifications/service.js';

export class AskError extends Error {
  constructor(code, { status = 422 } = {}) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const QUESTION_MAX = 500;

export function createAsk(db, blog, fromUser, question, isAnonymous) {
  const text = typeof question === 'string' ? question.trim() : '';
  if (!text) throw new AskError('ask.empty');
  if (text.length > QUESTION_MAX) throw new AskError('ask.too_long');
  if (!blog.ask_enabled) throw new AskError('ask.disabled', { status: 403 });
  const anon = isAnonymous === 'on' || isAnonymous === '1' || isAnonymous === true ? 1 : 0;
  if (anon && !blog.ask_anonymous) throw new AskError('ask.anon_disabled', { status: 403 });
  if (anon && fromUser) {
    // Отправитель добровольно скрывает имя — вопрос анонимный.
    fromUser = null;
  }
  if (!anon && !fromUser) throw new AskError('ask.login_required', { status: 401 });
  const info = db
    .prepare(
      `INSERT INTO asks (blog_id, from_user_id, is_anonymous, question, status, created_at)
       VALUES (?, ?, ?, ?, 'new', ?)`
    )
    .run(blog.id, fromUser ? fromUser.id : null, anon, text, Date.now());
  const ask = db.prepare('SELECT * FROM asks WHERE id = ?').get(info.lastInsertRowid);
  notify(db, { userId: blog.user_id, type: 'ask', actorUserId: anon ? null : fromUser?.id ?? null, askId: ask.id });
  return ask;
}

export function listAsks(db, blogId, { includeAnswered = false } = {}) {
  const statusCond = includeAnswered ? '' : "AND a.status = 'new'";
  return db
    .prepare(
      `SELECT a.*, b.slug AS from_slug, b.title AS from_title, am.storage_key AS from_avatar_key
       FROM asks a
       LEFT JOIN users u ON u.id = a.from_user_id
       LEFT JOIN blogs b ON b.user_id = a.from_user_id
       LEFT JOIN media am ON am.id = b.avatar_media_id
       WHERE a.blog_id = ? AND a.status IN ('new','answered') ${statusCond}
       ORDER BY a.created_at DESC
       LIMIT 50`
    )
    .all(blogId);
}

export function askCount(db, blogId) {
  return db.prepare("SELECT COUNT(*) AS n FROM asks WHERE blog_id = ? AND status = 'new'").get(blogId).n;
}

export function getAsk(db, askId, blogId) {
  const id = Number(askId);
  if (!Number.isInteger(id)) return null;
  return db.prepare('SELECT * FROM asks WHERE id = ? AND blog_id = ?').get(id, blogId);
}

// Ответ постом: вопрос цитируется blockquote'ом, ответ — текст автора (markdown).
export function answerAsk(ctx, ask, blog, answerText) {
  const text = typeof answerText === 'string' ? answerText.trim() : '';
  if (!text) throw new AskError('ask.answer_empty');
  if (text.length > 50_000) throw new AskError('composer.errors.too_long');
  const anonNote = ask.is_anonymous ? ' (анонимно)' : '';
  const body = `> **Вопрос${anonNote}:** ${ask.question}\n\n${text}`;
  const now = Date.now();
  const post = ctx.db.transaction(() => {
    const info = ctx.db
      .prepare(
        `INSERT INTO posts (blog_id, type, title, body, body_html, status, published_at, created_at, updated_at)
         VALUES (?, 'text', NULL, ?, ?, 'published', ?, ?, ?)`
      )
      .run(blog.id, body, renderMarkdown(body), now, now, now);
    ctx.db.prepare("UPDATE asks SET status = 'answered', answer_post_id = ? WHERE id = ?").run(info.lastInsertRowid, ask.id);
    return ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  })();
  return post;
}

export function ignoreAsk(db, askId, blogId) {
  const ask = getAsk(db, askId, blogId);
  if (!ask) throw new AskError('ask.not_found', { status: 404 });
  db.prepare("UPDATE asks SET status = 'ignored' WHERE id = ?").run(ask.id);
}

export function deleteAsk(db, askId, blogId) {
  const ask = getAsk(db, askId, blogId);
  if (!ask) throw new AskError('ask.not_found', { status: 404 });
  db.prepare("UPDATE asks SET status = 'deleted' WHERE id = ?").run(ask.id);
}

