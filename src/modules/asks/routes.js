// Маршруты Ask box и поисковых страниц (Этап 6).
import { Router } from 'express';
import { createAsk, listAsks, askCount, getAsk, answerAsk, ignoreAsk, deleteAsk, AskError } from './service.js';
import { searchPosts, searchBlogs, searchTags, postsByTag, tagExists } from '../search/service.js';
import { isFollowingTag, toggleTagFollow } from '../social/service.js';
import { getBlogView } from '../blogs/service.js';
import { getBlogByUserId } from '../blogs/service.js';
import { requireAuth } from '../auth/session.js';
import { decoratePosts, POST_TYPES } from '../posts/service.js';
import { askLimiter } from '../../middleware/rateLimit.js';
import { translate } from '../../lib/i18n.js';

const SLUG_RE = /^[a-z0-9-]{3,32}$/;
const TAG_RE = /^[^<>"'&]{1,60}$/;

export function searchRoutes(ctx, csrf) {
  const router = Router();

  const renderSearch = (req, res, extra = {}) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const type = POST_TYPES.includes(req.query.type) ? req.query.type : null;
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    let posts = [];
    let total = 0;
    let pages = 1;
    let blogs = [];
    let tags = [];
    if (q) {
      const result = searchPosts(ctx.db, q, { type, page, perPage: 10 });
      posts = decoratePosts(ctx.db, result.rows, req.user ? { userId: req.user.id } : null);
      total = result.total;
      pages = result.pages;
      blogs = searchBlogs(ctx.db, q);
      tags = searchTags(ctx.db, q);
    }
    res.render('pages/search', {
      title: q ? `${q} — ${translate(req.lang, 'search.title')}` : translate(req.lang, 'search.title'),
      q,
      type,
      types: POST_TYPES,
      posts,
      total,
      page,
      pages,
      blogs,
      tags,
      ...extra,
    });
  };

  router.get('/search', (req, res, next) => {
    try {
      renderSearch(req, res);
    } catch (err) {
      next(err);
    }
  });

  router.post('/tag/:name/follow', csrf.protection, (req, res, next) => {
    try {
      const name = String(req.params.name ?? '').trim().toLowerCase().slice(0, 30);
      if (!name) return next();
      const tag = ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
      if (!tag) return next();
      if (!req.user) return res.redirect(`/login?back=/tag/${encodeURIComponent(name)}`);
      toggleTagFollow(ctx.db, req.user.id, tag.id);
      res.redirect(303, `/tag/${encodeURIComponent(name)}`);
    } catch (err) {
      next(err);
    }
  });

  router.get('/tag/:name', (req, res, next) => {
    try {
      const name = String(req.params.name ?? '').trim().toLowerCase();
      if (!name || !TAG_RE.test(name)) return next();
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
      const followingTag = req.user
        ? isFollowingTag(ctx.db, req.user.id, (ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get(name) ?? {}).id)
        : false;
      const result = postsByTag(ctx.db, name, { page, perPage: 10 });
      const posts = decoratePosts(ctx.db, result.rows, req.user ? { userId: req.user.id } : null);
      res.render('pages/tag', {
        title: `#${name}`,
        tag: name,
        exists: result.total > 0 || tagExists(ctx.db, name),
        followingTag,
        posts,
        total: result.total,
        page: result.page,
        pages: result.pages,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function askRoutes(ctx, csrf) {
  const router = Router();

  // Страница вопроса: /:slug/ask — до /:slug по порядку маршрутов.
  router.get('/:slug/ask', (req, res, next) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) return next();
    try {
      const blog = getBlogView(ctx.db, slug);
      if (!blog || !blog.ask_enabled) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      res.render('pages/ask', {
        pageClass: 'blog',
        title: `${blog.title} — ${translate(req.lang, 'ask.title')}`,
        blog,
        theme: blog.theme,
        themePreview: false,
        isOwner: Boolean(req.user && req.user.id === blog.user_id),
        isFollowing: false,
        followers: 0,
        sent: req.query.sent === '1',
        error: null,
        values: {},
      });
    } catch (err) {
      next(err);
    }
  });

  // Отправка вопроса: лимитеры — анонимы 5/час (ADR-018), авторизованные 20/час.
  router.post('/:slug/ask', askLimiter, csrf.protection, (req, res, next) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) return next();
    try {
      const blog = getBlogView(ctx.db, slug);
      if (!blog || !blog.ask_enabled) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      try {
        createAsk(ctx.db, blog, req.user ?? null, req.body.question, req.body.anonymous);
        res.redirect(303, `/${slug}/ask?sent=1`);
      } catch (err) {
        if (err instanceof AskError && err.status === 422) {
          return res.status(422).render('pages/ask', {
            pageClass: 'blog',
            title: `${blog.title} — ${translate(req.lang, 'ask.title')}`,
            blog,
            theme: blog.theme,
            themePreview: false,
            isOwner: Boolean(req.user && req.user.id === blog.user_id),
            isFollowing: false,
            followers: 0,
            sent: false,
            error: translate(req.lang, err.code),
            values: { question: String(req.body.question ?? '') },
          });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  // Входящие вопросы владельца.
  router.get('/asks', requireAuth, (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      if (!blog) return res.redirect('/dashboard');
      const asks = listAsks(ctx.db, blog.id, { includeAnswered: false });
      res.render('pages/asks', {
        title: translate(req.lang, 'ask.inbox'),
        blog,
        asks,
        newCount: askCount(ctx.db, blog.id),
      });
    } catch (err) {
      next(err);
    }
  });

  // Форма ответа постом.
  router.get('/asks/:id/answer', requireAuth, (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      const ask = blog ? getAsk(ctx.db, req.params.id, blog.id) : null;
      if (!blog || !ask || ask.status !== 'new') {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      res.render('pages/ask_answer', {
        title: translate(req.lang, 'ask.answer'),
        blog,
        ask,
        error: null,
        values: {},
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/asks/:id/answer', requireAuth, csrf.protection, (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      const ask = blog ? getAsk(ctx.db, req.params.id, blog.id) : null;
      if (!blog || !ask || ask.status !== 'new') {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      try {
        const post = answerAsk(ctx, ask, blog, req.body.body);
        res.redirect(303, `/${blog.slug}/${post.id}`);
      } catch (err) {
        if (err instanceof AskError && err.status === 422) {
          return res.status(422).render('pages/ask_answer', {
            title: translate(req.lang, 'ask.answer'),
            blog,
            ask,
            error: translate(req.lang, err.code),
            values: { body: String(req.body.body ?? '') },
          });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  const askAction = (action) => (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      if (!blog) return res.redirect('/dashboard');
      if (action === 'ignore') ignoreAsk(ctx.db, req.params.id, blog.id);
      else deleteAsk(ctx.db, req.params.id, blog.id);
      res.redirect(303, '/asks');
    } catch (err) {
      if (err instanceof AskError && err.status === 404) {
        return res.status(404).render('pages/errors/error', {
          title: translate(req.lang, 'errors.404_title'),
          errorText: translate(req.lang, 'errors.404_text'),
        });
      }
      next(err);
    }
  };

  router.post('/asks/:id/ignore', requireAuth, csrf.protection, askAction('ignore'));
  router.post('/asks/:id/delete', requireAuth, csrf.protection, askAction('delete'));

  return router;
}

// Счётчик новых вопросов для сайдбара/шапки.
export function newAsksForUser(ctx, req) {
  if (!req.user) return 0;
  const blog = getBlogByUserId(ctx.db, req.user.id);
  return blog ? askCount(ctx.db, blog.id) : 0;
}
