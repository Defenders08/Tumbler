// Маршруты уведомлений: страница с автопрочтением, бейдж в шапке.
import { Router } from 'express';
import { listNotifications, markAllRead, unreadCount, notificationLink, notificationTextKey } from './service.js';
import { requireAuth } from '../auth/session.js';
import { translate } from '../../lib/i18n.js';

export function notificationRoutes(ctx) {
  const router = Router();
  router.use('/notifications', requireAuth);

  router.get('/notifications', (req, res, next) => {
    try {
      const rows = listNotifications(ctx.db, req.user.id);
      const items = rows.map((n) => ({
        ...n,
        link: notificationLink(ctx, n),
        text: translate(req.lang, notificationTextKey(n.type), {
          actor: n.actor_title ?? translate(req.lang, 'notify.someone'),
        }),
        isUnread: n.is_read === 0,
      }));
      const unread = unreadCount(ctx.db, req.user.id);
      markAllRead(ctx.db, req.user.id);
      res.render('pages/notifications', {
        title: translate(req.lang, 'notify.title'),
        items,
        hadUnread: unread,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// Счётчик для бейджа в шапке (вызывается в locale-middleware приложения).
export function unreadForUser(ctx, req) {
  if (!req.user) return 0;
  return unreadCount(ctx.db, req.user.id);
}
