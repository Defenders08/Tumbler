// Маршруты блога: настройки профиля/темы/аватара.
import { Router } from 'express';
import { getBlogByUserId, updateProfile, setAvatar } from './service.js';
import { updateAskSettings } from './asksSettings.js';
import { requireAuth } from '../auth/session.js';
import { processUpload, MediaError } from '../media/validate.js';
import { readTmpFile, cleanupTmp } from '../media/multer.js';
import { getUploadLimits } from '../../db/settings.js';
import { parseTheme, validateTheme } from './theme.js';
import { FormError } from '../posts/service.js';

export const TIMEZONES = ['UTC', 'Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Vladivostok', 'Europe/Berlin', 'Europe/Paris', 'Europe/London', 'Asia/Almaty', 'Asia/Tbilisi', 'Asia/Yerevan', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];

export function blogRoutes(ctx, csrf, upload) {
  const router = Router();
  // requireAuth строго на префикс /settings — иначе он перехватывал бы все запросы приложения.
  router.use('/settings', requireAuth);

  const getOwnBlog = (req, res) => {
    const blog = getBlogByUserId(ctx.db, req.user.id);
    if (!blog) {
      res.status(500).render('pages/errors/error', {
        title: ctx.translate(req, 'errors.500_title'),
        errorText: ctx.translate(req, 'errors.500_text'),
      });
      return null;
    }
    return blog;
  };

  router.get('/settings/blog', (req, res) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    res.render('pages/settings_blog', {
      title: ctx.translate(req, 'blog.settings_title'),
      blog,
      saved: req.query.saved === '1',
      avatarSaved: req.query.avatar === '1',
      error: null,
      values: { title: blog.title, description: blog.description },
    });
  });

  router.post('/settings/blog', csrf.protection, (req, res) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (!title || title.length > 100 || description.length > 500) {
      return res.status(422).render('pages/settings_blog', {
        title: ctx.translate(req, 'blog.settings_title'),
        blog,
        saved: false,
        avatarSaved: false,
        error: ctx.translate(req, 'auth.errors.required'),
        values: { title, description },
      });
    }
    updateProfile(ctx.db, blog.id, { title, description });
    updateAskSettings(ctx.db, blog.id, req.body);
    if (TIMEZONES.includes(req.body.timezone)) {
      ctx.db.prepare('UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?').run(req.body.timezone, Date.now(), req.user.id);
    }
    // Оформление по-новому: акцентный цвет
    const currentTheme = JSON.parse(blog.theme || '{}');
    const next = validateTheme({ accentColor: req.body.accent_color, bannerKey: currentTheme.bannerKey });
    ctx.db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), blog.id);
    res.redirect(303, '/settings/blog?saved=1');
  });

  router.post('/settings/blog/avatar', upload.single('avatar'), csrf.protection, async (req, res, next) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    try {
      if (!req.file) throw new MediaError('composer.errors.required_file');
      const limits = getUploadLimits(ctx.db);
      const buffer = await readTmpFile(req.file);
      const processed = await processUpload(buffer, 'avatar', limits);
      const storageKey = await ctx.storage.save(processed.buffer);

      const old = blog.avatar_media_id
        ? ctx.db.prepare('SELECT * FROM media WHERE id = ?').get(blog.avatar_media_id)
        : null;
      const info = ctx.db
        .prepare(
          `INSERT INTO media (owner_blog_id, kind, storage_key, mime_type, size, width, height, metadata, created_at)
           VALUES (?, 'avatar', ?, ?, ?, ?, ?, '{}', ?)`
        )
        .run(blog.id, storageKey, processed.mime, processed.buffer.byteLength, processed.width, processed.height, Date.now());
      setAvatar(ctx.db, blog.id, info.lastInsertRowid);
      if (old) {
        ctx.db.prepare('DELETE FROM media WHERE id = ?').run(old.id);
        await ctx.storage.remove(old.storage_key);
      }
      res.redirect(303, '/settings/blog?avatar=1');
    } catch (err) {
      await cleanupTmp(req.file ? [req.file] : []);
      if ((err instanceof MediaError || err instanceof FormError) && err.status === 422) {
        return res.status(422).render('pages/settings_blog', {
          title: ctx.translate(req, 'blog.settings_title'),
          blog,
          theme: parseTheme(blog.theme),
              saved: false,
          avatarSaved: false,
          error: ctx.translate(req, err.code),
          values: { title: blog.title, description: blog.description },
        });
      }
      next(err);
    }
  });

  // Загрузка баннера-шапки блога (картинка → media → theme.bannerKey).
  router.post('/settings/blog/banner', upload.single('banner'), csrf.protection, async (req, res, next) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    try {
      if (!req.file) throw new MediaError('composer.errors.required_file');
      const limits = getUploadLimits(ctx.db);
      const buffer = await readTmpFile(req.file);
      const processed = await processUpload(buffer, 'cover', limits);
      const storageKey = await ctx.storage.save(processed.buffer);
      const theme = validateTheme({ bannerKey: storageKey });
      // старый баннер удаляем из хранилища
      const old = parseTheme(blog.theme).bannerKey;
      if (old && old !== storageKey) await ctx.storage.remove(old);
      const merged = validateTheme({ bannerKey: storageKey });
      merged.accentColor = parseTheme(blog.theme).accentColor;
      ctx.db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), Date.now(), blog.id);
      res.redirect(303, '/settings/blog?saved=1');
    } catch (err) {
      await cleanupTmp(req.file ? [req.file] : []);
      if ((err instanceof MediaError || err instanceof FormError) && err.status === 422) {
        return res.status(422).render('pages/settings_blog', {
          title: ctx.translate(req, 'blog.settings_title'),
          blog,
          theme: parseTheme(blog.theme),
          timezones: TIMEZONES,
          saved: false,
          avatarSaved: false,
          error: ctx.translate(req, err.code),
          values: { title: blog.title, description: blog.description },
        });
      }
      next(err);
    }
  });

  router.post('/settings/blog/banner/remove', csrf.protection, async (req, res, next) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    const old = parseTheme(blog.theme).bannerKey;
    if (old) {
      ctx.db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ accentColor: parseTheme(blog.theme).accentColor }), Date.now(), blog.id);
      await ctx.storage.remove(old);
    }
    res.redirect(303, '/settings/blog?saved=1');
  });

  return router;
}
