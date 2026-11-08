// Уведомления (Этап 7): подписка, лайк, реблог, комментарий, вопрос, модерация.
// Антидубликаты — UNIQUE-индекс; INSERT OR IGNORE. Свои действия себе не уведомляют.
import { getBlogByUserId } from '../blogs/service.js';

export function notify(db, { userId, type, actorUserId = null, postId = null, askId = null }) {
  if (!userId) return;
  // Действие над собственным контентом не уведомляет.
  let actorBlogId = null;
  if (actorUserId) {
    if (actorUserId === userId) return;
    const blog = db.prepare('SELECT id FROM blogs WHERE user_id = ?').get(actorUserId);
    if (!blog) return;
    actorBlogId = blog.id;
  }
  db.prepare(
    `INSERT OR IGNORE INTO notifications (user_id, type, actor_blog_id, post_id, ask_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(userId, type, actorBlogId, postId, askId, Date.now());
}

export function unreadCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).n;
}

export function listNotifications(db, userId, { limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT n.*, b.slug AS actor_slug, b.title AS actor_title, am.storage_key AS actor_avatar_key,
              p.id AS rel_post_id, p.blog_id AS rel_post_blog_id
       FROM notifications n
       LEFT JOIN blogs b ON b.id = n.actor_blog_id
       LEFT JOIN media am ON am.id = b.avatar_media_id
       LEFT JOIN posts p ON p.id = n.post_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .all(userId, limit);
}

// Ссылка на объект уведомления (пост в блоге автора поста, ask-инбокс, блог актора).
export function notificationLink(ctx, n, viewerSlug) {
  switch (n.type) {
    case 'like':
    case 'reblog':
    case 'comment':
      if (n.rel_post_id) {
        const slug = ctx.db.prepare('SELECT slug FROM blogs WHERE id = ?').get(n.rel_post_blog_id)?.slug;
        if (slug) return `/${slug}/${n.rel_post_id}`;
      }
      return n.actor_slug ? `/${n.actor_slug}` : '/dashboard';
    case 'follow':
      return n.actor_slug ? `/${n.actor_slug}` : '/dashboard';
    case 'ask':
      return '/asks';
    default:
      return '/dashboard';
  }
}

// Текст уведомления: ключ локализации возвращает шаблон с {actor}.
export function notificationTextKey(type) {
  const map = {
    follow: 'notify.follow',
    like: 'notify.like',
    reblog: 'notify.reblog',
    comment: 'notify.comment',
    ask: 'notify.ask',
    moderation: 'notify.moderation',
  };
  return map[type] ?? 'notify.like';
}

// Отметить все уведомления пользователя прочитанными.
export function markAllRead(db, userId) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
}

// Хелпер для маршрутов: уведомить автора поста.
export function notifyPostAuthor(db, postId, type, actorUserId) {
  const row = db
    .prepare('SELECT u.id AS author_id FROM posts p JOIN blogs b ON b.id = p.blog_id JOIN users u ON u.id = b.user_id WHERE p.id = ?')
    .get(postId);
  if (!row) return;
  notify(db, { userId: row.author_id, type, actorUserId, postId });
}
