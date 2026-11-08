// Страницы: главная, дашборд, черновики, публичный блог, пермалинк.
import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { getBlogView } from '../blogs/service.js';
import { validateTheme } from '../blogs/theme.js';
import { viewerFollows } from '../social/routes.js';
import { followerCount, followedCount, followedBlogs } from '../social/service.js';
import { listBlogPosts, decoratePosts, getPostById } from '../posts/service.js';
import { translate as t9 } from '../../lib/i18n.js';
import { renderDashboardPage } from './dashboard.js';
import { translate } from '../../lib/i18n.js';
import { recordView } from '../api/stats.js';
import { blogStats, topPostsByViews } from '../api/stats.js';

const SLUG_RE = /^[a-z0-9-]{3,32}$/;

export function pagesRoutes(ctx) {
  const router = Router();

  router.get('/', (req, res) => {
    res.redirect(req.user ? '/dashboard' : '/login');
  });

  router.get('/dashboard', requireAuth, (req, res) => {
    renderDashboardPage(ctx, req, res);
  });

  // Статистика блога для владельца.
  router.get('/stats', requireAuth, (req, res, next) => {
    try {
      const blog = ctx.db.prepare('SELECT * FROM blogs WHERE user_id = ?').get(req.user.id);
      if (!blog) return res.redirect('/dashboard');
      res.render('pages/stats', {
        title: t9(req.lang, 'stats.title'),
        blog,
        stats: blogStats(ctx.db, blog.id),
        topPosts: topPostsByViews(ctx.db, blog.id, 5),
      });
    } catch (err) {
      next(err);
    }
  });

  // Очередь и расписание публикаций.
  router.get('/queue', requireAuth, (req, res, next) => {
    try {
      const blog = ctx.db.prepare('SELECT * FROM blogs WHERE user_id = ?').get(req.user.id);
      if (!blog) return res.redirect('/dashboard');
      const scheduled = ctx.db
        .prepare("SELECT * FROM posts WHERE blog_id = ? AND status = 'scheduled' ORDER BY scheduled_at ASC")
        .all(blog.id);
      const queued = ctx.db
        .prepare("SELECT * FROM posts WHERE blog_id = ? AND status = 'queued' ORDER BY queued_at ASC")
        .all(blog.id);
      const flash = req.query.published
        ? t9(req.lang, 'queue.published')
        : req.query.saved
          ? t9(req.lang, 'dashboard.draft_saved')
          : null;
      res.render('pages/queue', {
        title: t9(req.lang, 'queue.title'),
        blog,
        scheduled,
        queued,
        total: scheduled.length + queued.length,
        flash,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/drafts', requireAuth, (req, res, next) => {
    try {
      const blog = getBlogViewSafe(ctx, req.user.id);
      if (!blog) return res.redirect('/dashboard');
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
      const { rows, total, pages } = listBlogPosts(ctx.db, blog.id, 'draft', { page, perPage: 10, byUpdated: true });
      const posts = decoratePosts(ctx.db, rows, req.user ? { userId: req.user.id } : null);
      const flash = req.query.saved
        ? translate(req.lang, 'dashboard.draft_saved')
        : req.query.deleted
          ? translate(req.lang, 'drafts.deleted')
          : null;
      res.render('pages/drafts', {
        title: translate(req.lang, 'drafts.title'),
        blog,
        posts,
        page,
        pages,
        total,
        flash,
      });
    } catch (err) {
      next(err);
    }
  });

  // Публичная страница блога — доступна гостям.
  router.get('/:slug', (req, res, next) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) return next();
    try {
      const blogView = getBlogView(ctx.db, slug);
      if (!blogView) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'blog.not_found'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      const isOwner = Boolean(req.user && req.user.id === blogView.user_id);
      const isFollowing = viewerFollows(ctx, req, blogView);
      const followers = followerCount(ctx.db, blogView.id);

      // Предпросмотр темы из настроек: только владелец, параметры строго валидируются.
      let theme = blogView.theme;
      let themePreview = false;
      if (isOwner && typeof req.query.tp === 'string') {
        try {
          theme = validateTheme(JSON.parse(req.query.tp));
          themePreview = true;
        } catch {
          // некорректный параметр предпросмотра игнорируем
        }
      }

      const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
      const { rows, total, pages } = listBlogPosts(ctx.db, blogView.id, 'published', { page, perPage: 10 });
      const posts = decoratePosts(ctx.db, rows, req.user ? { userId: req.user.id } : null);
      const commentError = typeof req.query.commentError === 'string'
        ? translate(req.lang, req.query.commentError)
        : null;
      res.render('pages/blog', {
        pageClass: 'blog',
        title: blogView.title,
        blog: blogView,
        theme,
        themePreview,
        posts,
        page,
        pages,
        total,
        isOwner,
        isFollowing,
        followers,
        commentError,
      });
    } catch (err) {
      next(err);
    }
  });

  // Пермалинк поста: /:slug/:id
  router.get('/:slug/:postId', (req, res, next) => {
    const { slug, postId } = req.params;
    if (!SLUG_RE.test(slug) || !/^\d+$/.test(postId)) return next();
    try {
      const blogView = getBlogView(ctx.db, slug);
      const post = getPostById(ctx.db, postId);
      if (!blogView || !post || post.blog_id !== blogView.id) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      const isOwner = Boolean(req.user && req.user.id === blogView.user_id);
      if (post.status !== 'published' && !isOwner) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      const [decorated] = decoratePosts(ctx.db, [post], req.user ? { userId: req.user.id } : null);
      // Просмотр: не считаем визиты владельца; дедупликация по visitor cookie за сутки.
      // При первом визите cookie только выдаётся — визит начнёт считаться со следующих.
      const visitorCookie = req.cookies?.['tumbler.visitor'];
      if (post.status === 'published' && visitorCookie && !(req.user && req.user.id === blogView.user_id)) {
        recordView(ctx.db, post.id, visitorCookie);
      }
      res.render('pages/permalink', {
        pageClass: 'blog',
        title: blogView.title,
        blog: blogView,
        theme: blogView.theme,
        themePreview: false,
        post: decorated,
        commentError: typeof req.query.commentError === 'string'
          ? translate(req.lang, req.query.commentError)
          : null,
        isOwner,
        isFollowing: viewerFollows(ctx, req, blogView),
        followers: followerCount(ctx.db, blogView.id),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function getBlogViewSafe(ctx, userId) {
  // Для черновиков достаточно базовой строки блога.
  return ctx.db.prepare('SELECT * FROM blogs WHERE user_id = ?').get(userId);
}
