// Маршруты социальных механик.
// JSON API (лайк/подписка) — для fetch с заголовком x-csrf-token;
// формы (реблог, комментарии) — классический POST с PRG-редиректом.
import { Router } from 'express';
import { toggleFollow, toggleLike, addComment, deleteComment, isFollowing, followerCount, toggleTagFollow, toggleCommentLike } from './service.js';
import { createReblog, getPostById, FormError } from '../posts/service.js';
import { SocialError } from './service.js';
import { getBlogBySlug, getBlogByUserId } from '../blogs/service.js';
import { requireAuth } from '../auth/session.js';

const SLUG_RE = /^[a-z0-9-]{3,32}$/;

function safeBack(value, fallback = '/dashboard') {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

function apiAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: { code: 'need_login' } });
  }
  next();
}

export function socialApiRoutes(ctx, csrf) {
  const router = Router();
  // apiAuth только на маршруты действий — /api/v1 и прочие /api/* не должны перехватываться.
  router.use('/api/posts', apiAuth);
  router.use('/api/blogs', apiAuth);

  // Лайк (toggle). Клиент отправляет заголовок x-csrf-token.
  router.post('/api/posts/:id/like', csrf.protection, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new SocialError('social.post_not_published', { status: 404 });
      const result = toggleLike(ctx.db, req.user.id, id);
      const count = ctx.db.prepare('SELECT like_count FROM posts WHERE id = ?').get(id)?.like_count ?? 0;
      res.json({ liked: result.liked, likeCount: count });
    } catch (err) {
      next(err);
    }
  });

  // Лайк (toggle) комментария.
  router.post('/api/comments/:id/like', csrf.protection, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new SocialError('social.comment_not_found', { status: 404 });
      const result = toggleCommentLike(ctx.db, req.user.id, id);
      const count = ctx.db.prepare('SELECT like_count FROM comments WHERE id = ?').get(id)?.like_count ?? 0;
      res.json({ liked: result.liked, likeCount: count });
    } catch (err) {
      next(err);
    }
  });

  // Подписка (toggle) на тег по имени.
  router.post('/api/tags/:name/follow', csrf.protection, (req, res, next) => {
    try {
      const name = String(req.params.name ?? '').trim().toLowerCase().slice(0, 30);
      const tag = ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
      if (!tag) throw new SocialError('social.post_not_published', { status: 404 });
      const result = toggleTagFollow(ctx.db, req.user.id, tag.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Подписка (toggle) на блог по slug.
  router.post('/api/blogs/:slug/follow', csrf.protection, (req, res, next) => {
    try {
      const slug = req.params.slug;
      if (!SLUG_RE.test(slug)) throw new SocialError('social.post_not_published', { status: 404 });
      const blog = getBlogBySlug(ctx.db, slug);
      if (!blog) throw new SocialError('social.post_not_published', { status: 404 });
      const result = toggleFollow(ctx.db, req.user.id, blog);
      res.json({ following: result.following, followerCount: followerCount(ctx.db, blog.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function socialFormRoutes(ctx, csrf) {
  const router = Router();
  // requireAuth строго по префиксам: маршруты форм — /posts/:id/* и /comments/*.
  router.use('/posts', requireAuth);
  router.use('/comments', requireAuth);

  // Реблог с добавленным текстом (форма из карточки поста).
  router.post('/posts/:id/reblog', csrf.protection, (req, res, next) => {
    try {
      const root = getPostById(ctx.db, req.params.id);
      if (!root || root.status !== 'published') {
        throw new FormError('social.reblog_not_published', { status: 404 });
      }
      const blog = getBlogByUserId(ctx.db, req.user.id);
      if (!blog) throw new FormError('blog.not_found', { status: 500 });
      createReblog(ctx, root, blog, req.body);
      res.redirect(303, safeBack(req.body.back));
    } catch (err) {
      if ((err instanceof FormError || err instanceof SocialError) && err.status === 422) {
        return res.status(422).render('pages/errors/error', {
          title: ctx.translate(req, 'errors.403_title'),
          errorText: ctx.translate(req, err.code),
        });
      }
      next(err);
    }
  });

  // Комментарий к посту.
  router.post('/posts/:id/comments', csrf.protection, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
      addComment(ctx.db, id, req.user.id, req.body.body, parentId);
      res.redirect(303, safeBack(req.body.back) + '#post-' + id);
    } catch (err) {
      if (err instanceof SocialError && err.status === 422) {
        const back = safeBack(req.body.back);
        return res.redirect(303, back + (back.includes('?') ? '&' : '?') + 'commentError=' + encodeURIComponent(err.code));
      }
      next(err);
    }
  });

  // Удаление своего комментария.
  router.post('/comments/:id/delete', csrf.protection, (req, res, next) => {
    try {
      deleteComment(ctx.db, Number(req.params.id), req.user.id);
      res.redirect(303, safeBack(req.body.back));
    } catch (err) {
      if (err instanceof SocialError && err.status === 404) {
        return res.status(404).render('pages/errors/error', {
          title: ctx.translate(req, 'errors.404_title'),
          errorText: ctx.translate(req, 'errors.404_text'),
        });
      }
      next(err);
    }
  });

  return router;
}

// Для шаблонов: состояние подписки зрителя на блог.
export function viewerFollows(ctx, req, blog) {
  if (!req.user || !blog) return false;
  if (req.user.id === blog.user_id) return false;
  return isFollowing(ctx.db, req.user.id, blog.id);
}
