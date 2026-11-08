// Маршруты аккаунтов: вход, регистрация, выход, выбор языка.
import { Router } from 'express';
import { registerLimiter, loginLimiter } from '../../middleware/rateLimit.js';
import {
  registerUser,
  authenticateUser,
  errorMessage,
} from './service.js';
import { createSession, setSessionCookie, destroySession, clearSessionCookie } from './session.js';
import { getSetting } from '../../db/settings.js';

export function authRoutes(ctx, csrf) {
  const router = Router();

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('pages/auth/login', {
      pageClass: 'auth', title: ctx.translate(req, 'auth.login.title'), error: null, values: {} });
  });

  router.post('/login', loginLimiter, csrf.protection, async (req, res, next) => {
    try {
      const user = await authenticateUser(ctx, req.body);
      const { sid, ttl } = createSession(ctx, user.id);
      setSessionCookie(res, sid, ttl, ctx.config);
      res.redirect(303, '/dashboard');
    } catch (err) {
      if (err.status === 422 || err.status === 423) {
        return res.status(err.status).render('pages/auth/login', {
          title: ctx.translate(req, 'auth.login.title'),
          error: errorMessage(req.lang, err),
          values: { email: String(req.body.email ?? '') },
        });
      }
      next(err);
    }
  });

  router.get('/register', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    const open = getSetting(ctx.db, 'registration_open', true);
    if (!open) {
      return res.status(403).render('pages/errors/error', {
        pageClass: 'auth',
        title: ctx.translate(req, 'auth.register.closed'),
        errorText: ctx.translate(req, 'auth.register.closed'),
      });
    }
    res.render('pages/auth/register', {
        pageClass: 'auth', title: ctx.translate(req, 'auth.register.title'), error: null, values: {} });
  });

  router.post('/register', registerLimiter, csrf.protection, async (req, res, next) => {
    const open = getSetting(ctx.db, 'registration_open', true);
    if (!open) {
      return res.status(403).render('pages/errors/error', {
        pageClass: 'auth',
        title: ctx.translate(req, 'auth.register.closed'),
        errorText: ctx.translate(req, 'auth.register.closed'),
      });
    }
    try {
      const user = await registerUser(ctx, req.body);
      const { sid, ttl } = createSession(ctx, user.id);
      setSessionCookie(res, sid, ttl, ctx.config);
      res.redirect(303, '/dashboard');
    } catch (err) {
      if (err instanceof Error && err.status === 422) {
        return res.status(422).render('pages/auth/register', {
          title: ctx.translate(req, 'auth.register.title'),
          error: errorMessage(req.lang, err),
          values: {
            email: String(req.body.email ?? ''),
            slug: String(req.body.slug ?? ''),
            title: String(req.body.title ?? ''),
            locale: req.body.locale === 'en' ? 'en' : 'ru',
          },
        });
      }
      next(err);
    }
  });

  router.post('/logout', csrf.protection, (req, res) => {
    if (req.sessionId) {
      destroySession(ctx, req.sessionId);
      clearSessionCookie(res, ctx.config);
    }
    res.redirect(303, '/login');
  });

  // Выбор языка интерфейса: сохраняется в cookie, возвращает пользователя назад.
  router.get('/set-lang/:lang', (req, res) => {
    const lang = req.params.lang === 'en' ? 'en' : 'ru';
    res.cookie('tumbler.lang', lang, { sameSite: 'strict', path: '/', maxAge: 365 * 24 * 60 * 60 * 1000 });
    const back = typeof req.query.back === 'string' && req.query.back.startsWith('/') ? req.query.back : '/dashboard';
    res.redirect(back);
  });

  return router;
}
