// Сервис социальных механик: подписки, лайки, комментарии.
// Счётчики на постах обновляются в тех же транзакциях, что и события.
// Защита от повторных лайков/подписок — составные PRIMARY KEY + toggle-семантика.
import { renderPlain } from '../posts/render.js';
import { notify, notifyPostAuthor } from '../notifications/service.js';
import { canInteract } from '../moderation/service.js';

export class SocialError extends Error {
  constructor(code, { status = 422 } = {}) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const COMMENT_MAX = 1000;

// ---------- Подписки ----------

export function isFollowing(db, userId, blogId) {
  return Boolean(db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND blog_id = ?').get(userId, blogId));
}

export function followerCount(db, blogId) {
  return db.prepare('SELECT COUNT(*) AS n FROM follows WHERE blog_id = ?').get(blogId).n;
}

export function followedBlogs(db, userId, limit = 10) {
  return db
    .prepare(
      `SELECT b.slug, b.title, am.storage_key AS avatar_key
       FROM follows f JOIN blogs b ON b.id = f.blog_id
       LEFT JOIN media am ON am.id = b.avatar_media_id
       WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT ?`
    )
    .all(userId, limit);
}

export function followedCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?').get(userId).n;
}

// Toggle подписки. Подписаться на свой блог нельзя.
export function toggleFollow(db, userId, blog) {
  if (blog.user_id === userId) throw new SocialError('social.follow_self', { status: 400 });
  if (!canInteract(db, userId, blog.user_id)) throw new SocialError('social.blocked', { status: 403 });
  return db.transaction(() => {
    const del = db.prepare('DELETE FROM follows WHERE user_id = ? AND blog_id = ?').run(userId, blog.id);
    if (del.changes > 0) return { following: false };
    db.prepare('INSERT INTO follows (user_id, blog_id, created_at) VALUES (?, ?, ?)').run(userId, blog.id, Date.now());
    notify(db, { userId: blog.user_id, type: 'follow', actorUserId: userId });
    return { following: true };
  })();
}

// ---------- Лайки ----------

// Toggle лайка с денормализованным счётчиком на посте.
export function toggleLike(db, userId, postId) {
  return db.transaction(() => {
    const del = db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(userId, postId);
    if (del.changes > 0) {
      db.prepare('UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(postId);
      return { liked: false };
    }
    const post = db
      .prepare(
        `SELECT p.status, u.id AS author_id FROM posts p
         JOIN blogs b ON b.id = p.blog_id JOIN users u ON u.id = b.user_id
         WHERE p.id = ? AND p.status = 'published'`
      )
      .get(postId);
    if (!post) throw new SocialError('social.post_not_published', { status: 404 });
    if (!canInteract(db, userId, post.author_id)) throw new SocialError('social.blocked', { status: 403 });
    db.prepare('INSERT INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)').run(userId, postId, Date.now());
    db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(postId);
    notifyPostAuthor(db, postId, 'like', userId);
    return { liked: true };
  })();
}

// ---------- Комментарии ----------

export function addComment(db, postId, userId, rawBody) {
  const body = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!body) throw new SocialError('social.comment_empty');
  if (body.length > COMMENT_MAX) throw new SocialError('social.comment_too_long');
  const post = db
    .prepare(
      `SELECT p.id, u.id AS author_id FROM posts p
       JOIN blogs b ON b.id = p.blog_id JOIN users u ON u.id = b.user_id
       WHERE p.id = ? AND p.status = 'published'`
    )
    .get(postId);
  if (!post) throw new SocialError('social.post_not_published', { status: 404 });
  if (!canInteract(db, userId, post.author_id)) throw new SocialError('social.blocked', { status: 403 });
  const now = Date.now();
  const html = renderPlain(body.slice(0, COMMENT_MAX));
  return db.transaction(() => {
    const info = db
      .prepare('INSERT INTO comments (post_id, user_id, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(postId, userId, html, 'visible', now, now);
    db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').run(postId);
    notifyPostAuthor(db, postId, 'comment', userId);
    return db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  })();
}

// Мягкое удаление своего комментария (модерация чужих — этап 8).
export function deleteComment(db, commentId, userId) {
  const comment = db.prepare("SELECT * FROM comments WHERE id = ? AND status = 'visible'").get(commentId);
  if (!comment || comment.user_id !== userId) throw new SocialError('social.comment_not_found', { status: 404 });
  return db.transaction(() => {
    db.prepare("UPDATE comments SET status = 'deleted', updated_at = ? WHERE id = ?").run(Date.now(), commentId);
    db.prepare('UPDATE posts SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?').run(comment.post_id);
  })();
}
