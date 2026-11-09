// Сборка Express-приложения: middleware, маршруты, обработка ошибок.
// Фабрика createApp({config, db, ...}) позволяет тестам поднимать изолированный экземпляр.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { projectRoot } from './config.js';
import { createLiquidEngine } from './lib/views.js';
import { detectLocale, translate } from './lib/i18n.js';
import { sessionMiddleware } from './modules/auth/session.js';
import { setupCsrf } from './modules/auth/csrf.js';
import { createMulter } from './modules/media/multer.js';
import { createLocalStorage } from './modules/media/storage.js';
import { authRoutes } from './modules/auth/routes.js';
import { blogRoutes } from './modules/blogs/routes.js';
import { postsRoutes } from './modules/posts/routes.js';
import { mediaRoutes } from './modules/media/routes.js';
import { pagesRoutes } from './modules/pages/routes.js';
import { socialApiRoutes, socialFormRoutes } from './modules/social/routes.js';

import { searchRoutes, askRoutes, newAsksForUser } from './modules/asks/routes.js';
import { followedBlogs, followedCount, followedTags } from './modules/social/service.js';
import { reportRoutes, adminRoutes } from './modules/moderation/routes.js';
import { apiV1Routes } from './modules/api/routes.js';
import { notificationRoutes, unreadForUser } from './modules/notifications/routes.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, 'public');

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

export function createApp(ctx) {
  // Хелпер перевода для маршрутов: язык уже определён locale-middleware.
  ctx.translate = (req, key, params) => translate(req.lang ?? ctx.config.defaultLocale, key, params);
  ctx.storage = ctx.storage ?? createLocalStorage(ctx.config.uploadsDir);
  ctx.upload = ctx.upload ?? createMulter(ctx);

  const app = express();
  app.disable('x-powered-by');

  // Базовые security-заголовки (без внешних зависимостей).
  // CSP: скрипты только свои; inline-стили нужны темам блогов; CSS пользователя ограничен тем же CSP.
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'self'; form-action 'self'; " +
        "frame-src https://www.youtube.com https://player.vimeo.com https://w.soundcloud.com; " +
        "base-uri 'self'; object-src 'none'",
    });
    next();
  });
  if (ctx.config.isProduction) {
    app.set('trust proxy', 1);
  }

  app.engine('liquid', createLiquidEngine(ctx.config).express());
  app.set('view engine', 'liquid');
  app.set('views', path.join(projectRoot, 'src', 'views'));

  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Статика до сессий: assets не трогают БД.
  app.use('/static', express.static(publicDir, { maxAge: ctx.config.isProduction ? '7d' : 0 }));

  app.use(sessionMiddleware(ctx));

  // Локаль и общие locals для всех шаблонов.
  app.use((req, res, next) => {
    req.lang = detectLocale(req, req.user);
    res.locals.locale = req.lang;
    res.locals.user = req.user ?? null;
    res.locals.currentPath = req.path;
    // Согласие на показ 18+ контента — cookie, которую ставит кнопка «Показать».
    res.locals.nsfwAllowed = req.cookies?.['tumbler.nsfw'] === '1';
    res.locals.newAsks = newAsksForUser(ctx, req);
    // Данные правого сайдбара — считаются один раз на запрос для авторизованных.
    if (req.user) {
      const ownBlog = ctx.db.prepare('SELECT slug, title FROM blogs WHERE user_id = ?').get(req.user.id);
      res.locals.ownBlog = ownBlog ?? null;
      res.locals.draftsCount = ownBlog
        ? ctx.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE blog_id = ? AND status = 'draft'").get(ownBlog.id).n
        : 0;
      res.locals.subscriptions = followedBlogs(ctx.db, req.user.id, 10);
      res.locals.subscriptionsCount = followedCount(ctx.db, req.user.id);
      res.locals.myTags = followedTags(ctx.db, req.user.id, 10);
    }
    // Visitor id для дедупликации просмотров (без персональных данных).
    if (!req.cookies?.['tumbler.visitor']) {
      res.cookie('tumbler.visitor', crypto.randomBytes(8).toString('hex'), {
        sameSite: 'strict',
        path: '/',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
    }
    res.locals.unreadNotifications = unreadForUser(ctx, req);
    next();
  });

  const csrf = setupCsrf(ctx.config);
  app.use(csrf.exposeToken);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), version: pkg.version });
  });

  app.use(authRoutes(ctx, csrf));
  app.use(mediaRoutes(ctx));
  app.use(blogRoutes(ctx, csrf, ctx.upload));
  app.use(postsRoutes(ctx, csrf, ctx.upload));
  app.use(socialFormRoutes(ctx, csrf));
  app.use(socialApiRoutes(ctx, csrf));
  app.use(searchRoutes(ctx, csrf));
  app.use(askRoutes(ctx, csrf));
  app.use(notificationRoutes(ctx));
  app.use(reportRoutes(ctx, csrf));
  app.use(adminRoutes(ctx, csrf));
  app.use(apiV1Routes(ctx));
  app.use(pagesRoutes(ctx));

  app.use(notFoundHandler(ctx));
  app.use(errorHandler(ctx, csrf.utils.invalidCsrfTokenError));

  return app;
}
