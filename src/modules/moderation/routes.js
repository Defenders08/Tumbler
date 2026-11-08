// Маршруты модерации: жалобы (для всех), админ-панель (только admin/moderator).
// Все проверки ролей — серверные (ТЗ 6.1): скрытая кнопка не является защитой.
import { Router } from 'express';
import {
  createReport, listReports, reportTargetInfo, listActions, logAction,
  hidePost, unhidePost, hideComment, setUserStatus, resolveReport,
  ModError,
} from './service.js';
import { getPostById } from '../posts/service.js';
import { requireAuth } from '../auth/session.js';
import { reportLimiter } from '../../middleware/rateLimit.js';
import { translate } from '../../lib/i18n.js';
import { getSetting, setSetting } from '../../db/settings.js';

const SLUG_TARGETS = new Set(['post', 'comment', 'blog']);

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('pages/errors/error', {
        title: translate(req.lang, 'errors.403_title'),
        errorText: translate(req.lang, 'errors.403_text'),
      });
    }
    next();
  };
}

// ---------- Жалобы (любой авторизованный) ----------

export function reportRoutes(ctx, csrf) {
  const router = Router();
  router.use('/report', requireAuth);

  const renderForm = (req, res, { targetType, targetId, error = null, values = {} }) => {
    const back = typeof req.query.back === 'string' && req.query.back.startsWith('/') && !req.query.back.startsWith('//')
      ? req.query.back
      : '/dashboard';
    res.render('pages/report', {
      title: translate(req.lang, 'report.title'),
      targetType,
      targetId,
      error,
      values,
      backHref: back,
      info: translate(req.lang, 'report.target_' + targetType),
    });
  };

  router.get('/report/:type/:id', (req, res, next) => {
    try {
      const { type, id } = req.params;
      if (!SLUG_TARGETS.has(type) || !/^\d+$/.test(id)) return next();
      renderForm(req, res, { targetType: type, targetId: Number(id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/report/:type/:id', reportLimiter, csrf.protection, (req, res, next) => {
    try {
      const { type, id } = req.params;
      if (!SLUG_TARGETS.has(type) || !/^\d+$/.test(id)) return next();
      try {
        createReport(ctx.db, req.user.id, type, id, req.body.reason, req.body.details);
        res.redirect(303, safeBack(req.body.back));
      } catch (err) {
        if (err instanceof ModError && err.status === 422) {
          return renderForm(req, res, {
            targetType: type,
            targetId: Number(id),
            error: translate(req.lang, err.code),
            values: { details: req.body.details },
          });
        }
        if (err instanceof ModError && err.status === 404) {
          return res.status(404).render('pages/errors/error', {
            title: translate(req.lang, 'errors.404_title'),
            errorText: translate(req.lang, 'errors.404_text'),
          });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  function safeBack(value) {
    return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
  }

  return router;
}

// ---------- Админ-панель ----------

export function adminRoutes(ctx, csrf) {
  const router = Router();
  router.use('/admin', requireRole('admin', 'moderator'));

  const nav = (active) => ({ active });

  // Сводка.
  router.get('/admin', (req, res, next) => {
    try {
      const counts = {
        users: ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
        posts: ctx.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'").get().n,
        hidden: ctx.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'hidden'").get().n,
        comments: ctx.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'visible'").get().n,
        asks: ctx.db.prepare("SELECT COUNT(*) AS n FROM asks WHERE status = 'new'").get().n,
        openReports: ctx.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n,
        blockedUsers: ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'blocked'").get().n,
      };
      const recentActions = listActions(ctx.db, { limit: 10 });
      res.render('pages/admin/summary', {
        pageClass: 'admin',
        title: translate(req.lang, 'admin.title'),
        counts,
        recentActions,
        nav: nav('summary'),
      });
    } catch (err) {
      next(err);
    }
  });

  // Очередь жалоб.
  router.get('/admin/reports', (req, res, next) => {
    try {
      const status = ['open', 'resolved'].includes(req.query.status) ? req.query.status : 'open';
      const reports = listReports(ctx.db, { status }).map((r) => ({
        ...r,
        target: reportTargetInfo(ctx.db, r),
      }));
      res.render('pages/admin/reports', {
        pageClass: 'admin',
        title: translate(req.lang, 'admin.reports'),
        reports,
        status,
        nav: nav('reports'),
      });
    } catch (err) {
      next(err);
    }
  });

  // Резолюция жалобы: скрыть пост/комментарий или отклонить.
  router.post('/admin/reports/:id/resolve', csrf.protection, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const action = req.body.action; // hide_content | reject
      const reports = listReports(ctx.db, { status: 'open', limit: 1000 });
      const report = reports.find((r) => r.id === id);
      if (!report) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      if (action === 'hide_content') {
        if (report.target_type === 'post') hidePost(ctx.db, req.user.id, report.target_id, `жалоба #${id}`);
        else if (report.target_type === 'comment') hideComment(ctx.db, req.user.id, report.target_id, `жалоба #${id}`);
        else {
          // Жалоба на блог: скрываем все его опубликованные посты из лент.
          const posts = ctx.db.prepare("SELECT id FROM posts WHERE blog_id = ? AND status = 'published'").all(report.target_id);
          for (const p of posts) hidePost(ctx.db, req.user.id, p.id, `жалоба #${id} (блог)`);
        }
        resolveReport(ctx.db, req.user.id, id, 'content_hidden', action, req.body.details || null);
      } else {
        resolveReport(ctx.db, req.user.id, id, 'rejected', action, req.body.details || null);
      }
      res.redirect(303, '/admin/reports');
    } catch (err) {
      next(err);
    }
  });

  // Пользователи: поиск, бан/разбан.
  router.get('/admin/users', (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
      const users = ctx.db
        .prepare(
          `SELECT u.id, u.email, u.role, u.status, u.created_at, b.slug
           FROM users u LEFT JOIN blogs b ON b.user_id = u.id
           WHERE u.email LIKE ? OR b.slug LIKE ?
           ORDER BY u.created_at DESC LIMIT 50`
        )
        .all(`%${q}%`, `%${q}%`);
      res.render('pages/admin/users', {
        pageClass: 'admin',
        title: translate(req.lang, 'admin.users'),
        users,
        q,
        nav: nav('users'),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/users/:id/status', csrf.protection, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new ModError('mod.not_found', { status: 404 });
      setUserStatus(ctx.db, req.user.id, id, req.body.status === 'blocked' ? 'blocked' : 'active', req.body.reason || null);
      res.redirect(303, '/admin/users');
    } catch (err) {
      if (err instanceof ModError && err.status === 400) {
        return res.status(400).render('pages/errors/error', {
          title: translate(req.lang, 'errors.403_title'),
          errorText: translate(req.lang, 'mod.cannot_ban_admin'),
        });
      }
      next(err);
    }
  });

  // Посты: последние + скрытие/восстановление.
  router.get('/admin/posts', (req, res, next) => {
    try {
      const posts = ctx.db
        .prepare(
          `SELECT p.id, p.type, p.title, p.body, p.status, p.created_at, b.slug
           FROM posts p JOIN blogs b ON b.id = p.blog_id
           WHERE p.status IN ('published','hidden')
           ORDER BY p.created_at DESC LIMIT 50`
        )
        .all()
        .map((p) => ({ ...p, excerpt: (p.title || p.body || '').slice(0, 100) }));
      res.render('pages/admin/posts', {
        pageClass: 'admin',
        title: translate(req.lang, 'admin.posts'),
        posts,
        nav: nav('posts'),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/posts/:id/status', csrf.protection, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (req.body.status === 'hidden') hidePost(ctx.db, req.user.id, id, req.body.reason || null);
      else unhidePost(ctx.db, req.user.id, id);
      res.redirect(303, '/admin/posts');
    } catch (err) {
      if (err instanceof ModError && err.status === 404) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      next(err);
    }
  });

  // Настройки лимитов.
  router.get('/admin/settings', (req, res, next) => {
    try {
      res.render('pages/admin/settings', {
        pageClass: 'admin',
        title: translate(req.lang, 'admin.settings'),
        limits: getSetting(ctx.db, 'upload_limits', {}),
        registrationOpen: getSetting(ctx.db, 'registration_open', true),
        saved: req.query.saved === '1',
        nav: nav('settings'),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/settings', csrf.protection, (req, res, next) => {
    try {
      const limits = getSetting(ctx.db, 'upload_limits', {});
      for (const key of ['image', 'gif', 'audio', 'video']) {
        const mb = Number(req.body[key + '_mb']);
        if (Number.isFinite(mb) && mb >= 1 && mb <= 500) {
          limits[key] = Math.round(mb * 1024 * 1024);
        }
      }
      const maxFiles = Number(req.body.maxFilesPerPost);
      if (Number.isFinite(maxFiles) && maxFiles >= 1 && maxFiles <= 10) {
        limits.maxFilesPerPost = Math.round(maxFiles);
      }
      setSetting(ctx.db, 'upload_limits', limits);
      setSetting(ctx.db, 'registration_open', req.body.registration_open === 'on');
      logAction(ctx.db, req.user.id, 'update_settings', 'settings', 0, null);
      res.redirect(303, '/admin/settings?saved=1');
    } catch (err) {
      next(err);
    }
  });

  // Журнал действий.
  router.get('/admin/logs', (req, res, next) => {
    try {
      const actions = listActions(ctx.db, { limit: 100 });
      res.render('pages/admin/logs', {
        pageClass: 'admin',
        title: translate(req.lang, 'admin.logs'),
        actions,
        nav: nav('logs'),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
