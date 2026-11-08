// Модерация (Этап 8): жалобы, баны, скрытие контента, журнал действий.
// Все проверки ролей — на сервере; каждое чувствительное действие журналируется.
import { syncPost } from '../search/service.js';
import { notify } from '../notifications/service.js';

export class ModError extends Error {
  constructor(code, { status = 422 } = {}) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const REASONS = new Set(['spam', 'abuse', 'nsfw', 'other']);

// ---------- Жалобы ----------

export function createReport(db, reporterId, targetType, targetId, reason, details) {
  if (!REASONS.has(reason)) throw new ModError('report.bad_reason');
  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) throw new ModError('report.bad_target');
  // Цель должна существовать; для блогов — не своя.
  let exists = false;
  if (targetType === 'post') {
    exists = Boolean(db.prepare("SELECT 1 FROM posts WHERE id = ? AND status IN ('published','hidden')").get(id));
  } else if (targetType === 'comment') {
    exists = Boolean(db.prepare("SELECT 1 FROM comments WHERE id = ? AND status = 'visible'").get(id));
  } else if (targetType === 'blog') {
    exists = Boolean(db.prepare('SELECT 1 FROM blogs WHERE id = ?').get(id));
    if (exists) {
      const own = db.prepare('SELECT user_id FROM blogs WHERE id = ?').get(id);
      if (own.user_id === reporterId) throw new ModError('report.own_blog');
    }
  }
  if (!exists) throw new ModError('report.bad_target', { status: 404 });

  const info = db
    .prepare(
      `INSERT INTO reports (reporter_user_id, target_type, target_id, reason, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(reporterId, targetType, id, reason, typeof details === 'string' ? details.slice(0, 500) : null, Date.now());
  return info.lastInsertRowid;
}

export function listReports(db, { status = 'open', limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT r.*, u.email AS reporter_email, b.slug AS reporter_slug
       FROM reports r
       JOIN users u ON u.id = r.reporter_user_id
       LEFT JOIN blogs b ON b.user_id = r.reporter_user_id
       WHERE r.status = ?
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
    .all(status, limit);
}

// Контекст цели жалобы для админки (фрагмент содержимого + автор).
export function reportTargetInfo(db, report) {
  if (report.target_type === 'post') {
    const row = db
      .prepare(
        `SELECT p.id, p.type, p.title, p.body, p.status, b.slug AS blog_slug
         FROM posts p JOIN blogs b ON b.id = p.blog_id WHERE p.id = ?`
      )
      .get(report.target_id);
    if (!row) return null;
    return { ...row, excerpt: (row.title || row.body || '').slice(0, 120) };
  }
  if (report.target_type === 'comment') {
    const row = db
      .prepare(
        `SELECT c.id, c.body, c.status, b.slug AS blog_slug
         FROM comments c JOIN blogs b ON b.user_id = c.user_id WHERE c.id = ?`
      )
      .get(report.target_id);
    return row ? { ...row, excerpt: row.body.slice(0, 120) } : null;
  }
  const row = db.prepare('SELECT id, slug, title, description FROM blogs WHERE id = ?').get(report.target_id);
  return row ? { ...row, excerpt: (row.title + ' — ' + row.description).slice(0, 120) } : null;
}

// ---------- Журнал ----------

export function logAction(db, moderatorId, action, targetType, targetId, reason = null) {
  db.prepare(
    'INSERT INTO moderation_actions (moderator_user_id, action, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(moderatorId, action, targetType, targetId, reason, Date.now());
}

export function listActions(db, { limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT ma.*, u.email AS moderator_email
       FROM moderation_actions ma JOIN users u ON u.id = ma.moderator_user_id
       ORDER BY ma.created_at DESC LIMIT ?`
    )
    .all(limit);
}

// ---------- Действия модераторов ----------

// Скрыть пост (виден только владельцу; из лент/поиска исчезает).
export function hidePost(db, moderatorId, postId, reason) {
  const post = db.prepare('SELECT id, status FROM posts WHERE id = ?').get(postId);
  if (!post) throw new ModError('mod.not_found', { status: 404 });
  db.prepare("UPDATE posts SET status = 'hidden', updated_at = ? WHERE id = ?").run(Date.now(), postId);
  syncPost(db, postId);
  logAction(db, moderatorId, 'hide_post', 'post', postId, reason);
}

export function unhidePost(db, moderatorId, postId) {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) throw new ModError('mod.not_found', { status: 404 });
  db.prepare("UPDATE posts SET status = 'published', updated_at = ? WHERE id = ?").run(Date.now(), postId);
  syncPost(db, postId);
  logAction(db, moderatorId, 'unhide_post', 'post', postId);
}

// Скрыть комментарий.
export function hideComment(db, moderatorId, commentId, reason) {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!comment) throw new ModError('mod.not_found', { status: 404 });
  db.transaction(() => {
    db.prepare("UPDATE comments SET status = 'hidden', updated_at = ? WHERE id = ?").run(Date.now(), commentId);
    if (comment.status === 'visible') {
      db.prepare('UPDATE posts SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?').run(comment.post_id);
    }
  })();
  logAction(db, moderatorId, 'hide_comment', 'comment', commentId, reason);
}

// Блокировка (бан) пользователя: сессии мертвы на следующем запросе, вход закрыт.
export function setUserStatus(db, moderatorId, userId, status, reason) {
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  if (!user) throw new ModError('mod.not_found', { status: 404 });
  if (user.role === 'admin') throw new ModError('mod.cannot_ban_admin', { status: 400 });
  if (!['active', 'blocked'].includes(status)) throw new ModError('mod.bad_status');
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), userId);
  if (status === 'blocked') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    notify(db, { userId, type: 'moderation' });
  }
  logAction(db, moderatorId, status === 'blocked' ? 'ban_user' : 'unban_user', 'user', userId, reason);
}

// ---------- Пользовательские блокировки ----------

export function isBlocked(db, blockerId, blockedId) {
  return Boolean(db.prepare('SELECT 1 FROM blocks WHERE blocker_user_id = ? AND blocked_user_id = ?').get(blockerId, blockedId));
}

// Проверка: actor может взаимодействовать с владельцем контента (ownerUserId).
export function canInteract(db, actorUserId, ownerUserId) {
  if (!actorUserId || !ownerUserId || actorUserId === ownerUserId) return true;
  return !isBlocked(db, ownerUserId, actorUserId);
}

// ---------- Резолюция жалоб ----------

export function resolveReport(db, moderatorId, reportId, decision, action, reason) {
  const report = db.prepare('SELECT * FROM reports WHERE id = ? AND status = ?').get(reportId, 'open');
  if (!report) throw new ModError('mod.not_found', { status: 404 });
  db.prepare("UPDATE reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(
    decision, moderatorId, Date.now(), reportId
  );
  // Журналируется и резолюция, и (если были) контентные действия.
  logAction(db, moderatorId, `resolve_report_${decision}`, report.target_type, report.target_id, reason);
}
