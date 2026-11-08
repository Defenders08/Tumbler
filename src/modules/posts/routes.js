// Маршруты постов: создание (публикация/черновик), редактирование, удаление, предпросмотр.
import { Router } from 'express';
import {
  createPost,
  updatePost,
  deletePost,
  getPostById,
  decoratePosts,
  POST_TYPES,
  FormError,
} from './service.js';
import { MediaError } from '../media/validate.js';
import { renderMarkdown, renderPlain, isSafeLinkUrl } from './render.js';
import { parseTags } from './service.js';
import { getBlogByUserId } from '../blogs/service.js';
import { requireAuth } from '../auth/session.js';
import { renderDashboardPage } from '../pages/dashboard.js';
import { syncPost } from '../search/service.js';

function isComposerError(err) {
  return (err instanceof FormError || err instanceof MediaError) && (err.status === 422 || err.status === 404);
}

export function postsRoutes(ctx, csrf, upload) {
  const router = Router();
  // requireAuth строго на префикс /posts — иначе он перехватывал бы все запросы приложения.
  router.use('/posts', requireAuth);

  // Создание поста. multer.any() ДО csrf: multipart-тело должно быть разобрано,
  // иначе поле _csrf недоступно. Файлы до проверки CSRF попадают во временный каталог
  // и чистятся при любой ошибке.
  router.post('/posts', upload.any(), csrf.protection, async (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      if (!blog) throw new FormError('blog.not_found', { status: 500 });
      const rawAction = req.body.action;
      let action = 'publish';
      if (rawAction === 'draft') action = 'draft';
      else if (rawAction === 'schedule' || rawAction === 'queue') action = rawAction;

      if (action === 'schedule') {
        const { localToUtcEpoch } = await import('../../scheduler/index.js');
        const local = typeof req.body.scheduled_at_local === 'string' ? req.body.scheduled_at_local : '';
        const epoch = localToUtcEpoch(local, req.user.timezone ?? 'UTC');
        if (!Number.isFinite(epoch) || epoch < Date.now() - 60_000) {
          return renderDashboardPage(ctx, req, res, {
            status: 422,
            composerError: ctx.translate(req, 'composer.errors.bad_schedule'),
            openType: POST_TYPES.includes(req.body.type) ? req.body.type : 'text',
            values: req.body,
          });
        }
        req.body.scheduled_at_utc = epoch;
      }

      const post = await createPost(ctx, blog, req.body, req.files, action);
      const back = req.body.back;
      if (action === 'draft') return res.redirect(303, '/drafts?saved=1');
      if (action === 'schedule' || action === 'queue') return res.redirect(303, '/queue?saved=1');
      if (typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')) {
        return res.redirect(303, back);
      }
      res.redirect(303, `/dashboard?created=${post.id}`);
    } catch (err) {
      if (isComposerError(err) && err.status === 422) {
        // Понятная ошибка с сохранением введённых значений (файлы повторно приложить).
        return renderDashboardPage(ctx, req, res, {
          status: 422,
          composerError: ctx.translate(req, err.code),
          composerErrorNote: ctx.translate(req, 'composer.file_note'),
          openType: POST_TYPES.includes(req.body.type) ? req.body.type : 'text',
          values: req.body,
        });
      }
      next(err);
    }
  });

  // Предпросмотр: текстовые поля без сохранения и без файлов.
  router.post('/posts/preview', csrf.protection, (req, res, next) => {
    try {
      const type = POST_TYPES.includes(req.body.type) ? req.body.type : 'text';
      const blog = getBlogByUserId(ctx.db, req.user.id);
      const view = {
        id: null,
        type,
        title: null,
        body_html: '',
        quote_text: '',
        link_url: '',
        blog_slug: blog?.slug ?? '',
        blog_title: blog?.title ?? '',
        author_user_id: req.user.id,
        nsfw: req.body.nsfw === 'on' ? 1 : 0,
        published_at: Date.now(),
        like_count: 0,
        reblog_count: 0,
        comment_count: 0,
        media: [],
        tags: parseTags(req.body.tags),
      };
      const text = typeof req.body.body === 'string' ? req.body.body : '';
      if (type === 'text') {
        view.title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) || null : null;
        view.body_html = renderMarkdown(text);
      } else if (type === 'quote') {
        view.quote_text = typeof req.body.quote === 'string' ? req.body.quote.slice(0, 5000) : '';
        view.body = typeof req.body.source === 'string' ? req.body.source.slice(0, 300) : '';
      } else if (type === 'link') {
        const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';
        view.link_url = isSafeLinkUrl(url) ? url : '';
        view.title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) || null : null;
        view.body_html = renderPlain(typeof req.body.description === 'string' ? req.body.description.slice(0, 2000) : '');
      } else if (type === 'audio' || type === 'video') {
        view.title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) || null : null;
        view.body_html = renderMarkdown(text.slice(0, 10000));
      } else {
        view.body_html = renderMarkdown(text.slice(0, 10000));
      }
      res.render('pages/preview', {
        title: ctx.translate(req, 'composer.preview'),
        post: view,
      });
    } catch (err) {
      next(err);
    }
  });

  // Редактирование.
  router.get('/posts/:id/edit', (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      const post = getPostById(ctx.db, req.params.id);
      if (!post || !blog || post.blog_id !== blog.id) {
        return res.status(404).render('pages/errors/error', {
          title: ctx.translate(req, 'errors.404_title'),
          errorText: ctx.translate(req, 'errors.404_text'),
        });
      }
      const [decorated] = decoratePosts(ctx.db, [post]);
      const values = {
        title: decorated.title,
        body: decorated.body,
        quote: decorated.quote_text,
        source: decorated.body,
        url: decorated.link_url,
        description: decorated.body,
        tags: decorated.tags.join(', '),
        nsfw: decorated.nsfw ? 'on' : null,
      };
      res.render('pages/edit_post', { title: ctx.translate(req, 'post.edit'), post: decorated, values });
    } catch (err) {
      next(err);
    }
  });

  router.post('/posts/:id/edit', csrf.protection, (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      if (!blog) throw new FormError('blog.not_found', { status: 404 });
      const publishNow = req.body.action === 'publish';
      updatePost(ctx, blog, req.params.id, req.body, publishNow);
      res.redirect(303, publishNow ? '/dashboard?created=1' : '/drafts?saved=1');
    } catch (err) {
      if (isComposerError(err)) {
        return res.status(err.status).render('pages/errors/error', {
          title: ctx.translate(req, 'errors.403_title'),
          errorText: ctx.translate(req, err.code),
        });
      }
      next(err);
    }
  });

  // Опубликовать сейчас из расписания/очереди.
  router.post('/posts/:id/publish-now', csrf.protection, (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      const post = blog && getPostById(ctx.db, req.params.id);
      if (!blog || !post || post.blog_id !== blog.id || !['scheduled', 'queued'].includes(post.status)) {
        return res.status(404).render('pages/errors/error', {
          title: ctx.translate(req, 'errors.404_title'),
          errorText: ctx.translate(req, 'errors.404_text'),
        });
      }
      const now = Date.now();
      ctx.db.prepare("UPDATE posts SET status = 'published', published_at = ?, scheduled_at = NULL, queued_at = NULL, updated_at = ? WHERE id = ?").run(now, now, post.id);
      syncPost(ctx.db, post.id);
      res.redirect(303, '/queue?published=1');
    } catch (err) {
      next(err);
    }
  });

  // Отменить расписание/очередь — вернуть в черновики.
  router.post('/posts/:id/cancel', csrf.protection, (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      const post = blog && getPostById(ctx.db, req.params.id);
      if (!blog || !post || post.blog_id !== blog.id || !['scheduled', 'queued'].includes(post.status)) {
        return res.status(404).render('pages/errors/error', {
          title: ctx.translate(req, 'errors.404_title'),
          errorText: ctx.translate(req, 'errors.404_text'),
        });
      }
      ctx.db.prepare("UPDATE posts SET status = 'draft', scheduled_at = NULL, queued_at = NULL, updated_at = ? WHERE id = ?").run(Date.now(), post.id);
      res.redirect(303, '/drafts?saved=1');
    } catch (err) {
      next(err);
    }
  });

  // Удаление (мягкое).
  router.post('/posts/:id/delete', csrf.protection, (req, res, next) => {
    try {
      const blog = getBlogByUserId(ctx.db, req.user.id);
      if (!blog) throw new FormError('blog.not_found', { status: 404 });
      deletePost(ctx, blog, req.params.id);
      res.redirect(303, req.body.back === 'drafts' ? '/drafts?deleted=1' : '/dashboard?deleted=1');
    } catch (err) {
      if (isComposerError(err)) {
        return res.status(err.status).render('pages/errors/error', {
          title: ctx.translate(req, 'errors.403_title'),
          errorText: ctx.translate(req, err.code),
        });
      }
      next(err);
    }
  });

  return router;
}
