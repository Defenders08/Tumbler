// Серверные сессии в SQLite: создание, загрузка пользователя по cookie, удаление.
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'tumbler.sid';

export function createSession(ctx, userId) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const ttl = ctx.config.sessionTtlDays * 24 * 60 * 60 * 1000;
  ctx.db
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(sid, userId, now + ttl, now, now);
  return { sid, ttl };
}

export function setSessionCookie(res, sid, ttl, config) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
    maxAge: ttl,
  });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'strict', secure: config.isProduction, httpOnly: true });
}

export function destroySession(ctx, sid) {
  ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
}

// Загрузка пользователя по сессии; просроченные сессии удаляются на месте.
export function sessionMiddleware(ctx) {
  const select = ctx.db.prepare(`
    SELECT s.id AS sid, s.expires_at, u.id AS uid, u.email, u.role, u.status, u.locale, u.timezone,
           b.slug AS blog_slug, m.storage_key AS avatar_key
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN blogs b ON b.user_id = u.id
    LEFT JOIN media m ON m.id = b.avatar_media_id
    WHERE s.id = ?
  `);
  const touch = ctx.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?');
  const drop = ctx.db.prepare('DELETE FROM sessions WHERE id = ?');
  let lastTouch = 0;

  return (req, res, next) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) {
      const row = select.get(sid);
      if (row) {
        if (row.expires_at <= Date.now()) {
          drop.run(sid);
        } else if (row.status === 'active') {
          req.sessionId = sid;
          req.user = {
            id: row.uid,
            email: row.email,
            role: row.role,
            locale: row.locale,
            timezone: row.timezone,
            blogSlug: row.blog_slug,
            avatarKey: row.avatar_key,
          };
          // last_seen_at обновляем не чаще раза в минуту, чтобы не нагружать БД.
          const now = Date.now();
          if (now - lastTouch > 60_000) {
            touch.run(now, sid);
            lastTouch = now;
          }
        }
      }
    }
    next();
  };
}

// Требует авторизацию: гость отправляется на /login.
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

// Периодическая чистка просроченных сессий.
export function purgeExpiredSessions(ctx) {
  ctx.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}
