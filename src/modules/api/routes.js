// API v1 (Этап 9): документированный JSON API.
// Чтение — публично; приватные данные — только по сессионной cookie.
// Формат: { data, meta } / ошибки { error: { code, message } }.
// Полная документация — docs/api.md.
import { Router } from 'express';
import { listBlogPosts, getPostById, decoratePosts, POST_TYPES } from '../posts/service.js';
import { listFeedPosts } from '../posts/service.js';
import { getBlogView } from '../blogs/service.js';
import { parseTheme } from '../blogs/theme.js';
import { searchPosts, searchBlogs, searchTags } from '../search/service.js';
import { viewsForPost, recordView, blogStats } from './stats.js';
import { listNotifications, unreadCount } from '../notifications/service.js';
import { followerCount } from '../social/service.js';
import { requireAuth } from '../auth/session.js';

const json = (res, status, payload) => res.status(status).json(payload);

function postToJson(p) {
  return {
    id: p.id,
    type: p.type,
    title: p.title ?? null,
    bodyHtml: p.body_html ?? '',
    quoteText: p.quote_text ?? null,
    linkUrl: p.link_url ?? null,
    status: p.status,
    nsfw: Boolean(p.nsfw),
    tags: p.tags,
    blog: { slug: p.blog_slug, title: p.blog_title },
    counts: { likes: p.like_count, reblogs: p.reblog_count, comments: p.comment_count },
    publishedAt: p.published_at ? new Date(p.published_at).toISOString() : null,
    url: `/${p.blog_slug}/${p.id}`,
  };
}

export function apiV1Routes(ctx) {
  const router = Router();

  // Свои данные (сессия).
  router.get('/api/v1/me', requireAuthApi, (req, res) => {
    const blog = ctx.db.prepare('SELECT slug, title, description, ask_enabled FROM blogs WHERE user_id = ?').get(req.user.id);
    json(res, 200, {
      data: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        locale: req.user.locale,
        timezone: req.user.timezone,
        blog: blog
          ? { slug: blog.slug, title: blog.title, description: blog.description, askEnabled: Boolean(blog.ask_enabled) }
          : null,
        unreadNotifications: unreadCount(ctx.db, req.user.id),
      },
    });
  });

  // Лента публичных постов (все блоги), хронологическая.
  router.get('/api/v1/posts', (req, res, next) => {
    try {
      const page = Math.max(1, intOrNull(req.query.page) ?? 1);
      const perPage = clamp(intOrNull(req.query.limit) ?? 10, 1, 50);
      const type = POST_TYPES.includes(req.query.type) ? req.query.type : null;
      const result = publicPosts(ctx.db, { page, perPage, type });
      const posts = decoratePosts(ctx.db, result.rows, null);
      json(res, 200, {
        data: posts.map(postToJson),
        meta: { page: result.page, perPage, total: result.total, pages: result.pages },
      });
    } catch (err) {
      next(err);
    }
  });

  // Один пост.
  router.get('/api/v1/posts/:id', (req, res, next) => {
    try {
      const post = getPostById(ctx.db, req.params.id);
      if (!post || post.status !== 'published') {
        return json(res, 404, { error: { code: 'not_found', message: 'Post not found' } });
      }
      const [decorated] = decoratePosts(ctx.db, [post], null);
      json(res, 200, {
        data: { ...postToJson(decorated), views: viewsForPost(ctx.db, post.id) },
      });
    } catch (err) {
      next(err);
    }
  });

  // Публичная статистика блога.
  router.get('/api/v1/blogs/:slug/stats', (req, res, next) => {
    try {
      const blog = getBlogView(ctx.db, req.params.slug);
      if (!blog) return json(res, 404, { error: { code: 'not_found', message: 'Blog not found' } });
      json(res, 200, { data: blogStats(ctx.db, blog.id) });
    } catch (err) {
      next(err);
    }
  });

  // Посты конкретного блога.
  router.get('/api/v1/blogs/:slug/posts', (req, res, next) => {
    try {
      const blog = getBlogView(ctx.db, req.params.slug);
      if (!blog) return json(res, 404, { error: { code: 'not_found', message: 'Blog not found' } });
      const page = Math.max(1, intOrNull(req.query.page) ?? 1);
      const perPage = clamp(intOrNull(req.query.limit) ?? 10, 1, 50);
      const type = POST_TYPES.includes(req.query.type) ? req.query.type : null;
      let rows, total;
      if (type) {
        const r = listBlogPosts(ctx.db, blog.id, 'published', { page, perPage: 1000 });
        rows = r.rows.filter((p) => p.type === type).slice(0, perPage);
        total = r.rows.filter((p) => p.type === type).length;
      } else {
        const r = listBlogPosts(ctx.db, blog.id, 'published', { page, perPage });
        rows = r.rows;
        total = r.total;
      }
      const posts = decoratePosts(ctx.db, rows, null);
      json(res, 200, {
        data: posts.map(postToJson),
        meta: { page, perPage, total, pages: Math.max(1, Math.ceil(total / perPage)) },
      });
    } catch (err) {
      next(err);
    }
  });

  // Блог + агрегаты.
  router.get('/api/v1/blogs/:slug', (req, res, next) => {
    try {
      const blog = getBlogView(ctx.db, req.params.slug);
      if (!blog) return json(res, 404, { error: { code: 'not_found', message: 'Blog not found' } });
      json(res, 200, {
        data: {
          slug: blog.slug,
          title: blog.title,
          description: blog.description,
          theme: parseTheme(blog.theme),
          askEnabled: Boolean(blog.ask_enabled),
          askAnonymous: Boolean(blog.ask_anonymous),
          avatarUrl: blog.avatar_key ? `/media/${blog.avatar_key}` : null,
          followers: followerCount(ctx.db, blog.id),
          posts: ctx.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE blog_id = ? AND status = 'published'").get(blog.id).n,
          createdAt: new Date(blog.created_at).toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // Список блогов.
  router.get('/api/v1/blogs', (req, res, next) => {
    try {
      const limit = clamp(intOrNull(req.query.limit) ?? 20, 1, 50);
      const blogs = ctx.db
        .prepare(
          `SELECT b.slug, b.title, b.description, u.status
           FROM blogs b JOIN users u ON u.id = b.user_id
           WHERE u.status = 'active'
           ORDER BY b.created_at DESC LIMIT ?`
        )
        .all(limit)
        .filter((b) => b.status === 'active')
        .map(({ slug, title, description }) => ({ slug, title, description, url: `/${slug}` }));
      json(res, 200, { data: blogs, meta: { count: blogs.length } });
    } catch (err) {
      next(err);
    }
  });

  // Поиск (посты/блоги/теги одним запросом).
  router.get('/api/v1/search', (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      if (!q) return json(res, 200, { data: { posts: [], blogs: [], tags: [] } });
      const type = POST_TYPES.includes(req.query.type) ? req.query.type : null;
      const found = searchPosts(ctx.db, q, { type, page: 1, perPage: 20 });
      const posts = decoratePosts(ctx.db, found.rows, null);
      json(res, 200, {
        data: {
          posts: posts.map(postToJson),
          blogs: searchBlogs(ctx.db, q),
          tags: searchTags(ctx.db, q),
        },
        meta: { query: q, totalPosts: found.total },
      });
    } catch (err) {
      next(err);
    }
  });

  // Тег: посты по тегу.
  router.get('/api/v1/tags/:name', (req, res, next) => {
    try {
      const name = String(req.params.name ?? '').toLowerCase().slice(0, 60);
      const page = Math.max(1, intOrNull(req.query.page) ?? 1);
      const perPage = clamp(intOrNull(req.query.limit) ?? 10, 1, 50);
      const rows = ctx.db
        .prepare(
          `SELECT p.id FROM posts p
           WHERE p.status = 'published' AND p.id IN
             (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)
           ORDER BY p.published_at DESC LIMIT ? OFFSET ?`
        )
        .all(name, perPage, (page - 1) * perPage);
      const total = ctx.db
        .prepare(
          `SELECT COUNT(*) AS n FROM posts p
           WHERE p.status = 'published' AND p.id IN
             (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)`
        )
        .get(name).n;
      const posts = rows.length
        ? decoratePosts(ctx.db, rows.map((r) => getPostById(ctx.db, r.id)), null)
        : [];
      json(res, 200, {
        data: { tag: name, posts: posts.map(postToJson) },
        meta: { page, perPage, total, pages: Math.max(1, Math.ceil(total / perPage)) },
      });
    } catch (err) {
      next(err);
    }
  });

  // Уведомления (сессия).
  router.get('/api/v1/notifications', requireAuthApi, (req, res) => {
    const rows = listNotifications(ctx.db, req.user.id, { limit: 50 });
    json(res, 200, {
      data: rows.map((n) => ({
        id: n.id,
        type: n.type,
        isRead: Boolean(n.is_read),
        actor: n.actor_slug ? { slug: n.actor_slug, title: n.actor_title } : null,
        postId: n.post_id ?? null,
        createdAt: new Date(n.created_at).toISOString(),
      })),
      meta: { unread: unreadCount(ctx.db, req.user.id) },
    });
  });

  return router;
}

// Публичные посты (все блоги) — простая выборка для /api/v1/posts.
function publicPosts(db, { page, perPage, type }) {
  const offset = (page - 1) * perPage;
  const typeCond = type ? 'AND p.type = ?' : '';
  const args = type ? [type] : [];
  const rows = db
    .prepare(
      `SELECT p.*, b.slug AS blog_slug, b.title AS blog_title, u.id AS author_user_id, am.storage_key AS blog_avatar_key
       FROM posts p
       JOIN blogs b ON b.id = p.blog_id
       JOIN users u ON u.id = b.user_id
       LEFT JOIN media am ON am.id = b.avatar_media_id
       WHERE p.status = 'published' ${typeCond}
       ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, perPage, offset);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM posts p WHERE p.status = 'published' ${typeCond}`)
    .get(...args).n;
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

function requireAuthApi(req, res, next) {
  if (!req.user) {
    return json(res, 401, { error: { code: 'need_login', message: 'Session cookie required' } });
  }
  next();
}

function intOrNull(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
