// Маршруты блога: настройки профиля/темы/аватара.
import { Router } from 'express';
import { getBlogByUserId, updateProfile, setAvatar, withTint } from './service.js';
import { updateAskSettings } from './asksSettings.js';
import { requireAuth } from '../auth/session.js';
import { processUpload, MediaError } from '../media/validate.js';
import { readTmpFile, cleanupTmp } from '../media/multer.js';
import { getUploadLimits } from '../../db/settings.js';
import { parseTheme, validateTheme } from './theme.js';
import { SOCIAL_NETWORKS, normalizeSocials } from './socials.js';
import { dominantHue } from '../../lib/colors.js';
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

  const renderSettings = (req, res, blog, locals = {}) => {
    res.render('pages/settings_blog', {
      title: ctx.translate(req, 'blog.settings_title'),
      blog,
      theme: withTint(parseTheme(blog.theme)),
      networks: SOCIAL_NETWORKS.map((id) => ({ id, title: ctx.translate(req, `social_net.${id}`) })),
      timezones: TIMEZONES,
      saved: false,
      avatarSaved: false,
      error: null,
      values: { title: blog.title, description: blog.description },
      ...locals,
    });
  };

  router.get('/settings/blog', (req, res) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    renderSettings(req, res, blog, {
      saved: req.query.saved === '1',
      avatarSaved: req.query.avatar === '1',
    });
  });

  router.post('/settings/blog', csrf.protection, (req, res) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;

    // Формы разделены на три блока; старый полный POST без section поддерживается.
    const section = req.body.section;
    const isFull = !['profile', 'appearance', 'social'].includes(section);
    const isProfile = isFull || section === 'profile';
    const isAppearance = isFull || section === 'appearance';
    const isSocial = isFull || section === 'social';

    if (isProfile) {
      const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
      const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
      if (!title || title.length > 100 || description.length > 500) {
        res.status(422);
        return renderSettings(req, res, blog, {
          error: ctx.translate(req, 'auth.errors.required'),
          values: { title, description },
        });
      }
      updateProfile(ctx.db, blog.id, { title, description });
      // Соцсети живут в теме: сохраняем остальные поля без изменений.
      const current = parseTheme(blog.theme);
      const socials = normalizeSocials(req.body, (key) => ctx.translate(req, key));
      if (isFull || req.body.social_network !== undefined || req.body.social_url !== undefined || socials.length > 0) {
        const next = validateTheme({ ...current, socials });
        ctx.db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), blog.id);
      }
    }

    if (isSocial) {
      updateAskSettings(ctx.db, blog.id, req.body);
      if (TIMEZONES.includes(req.body.timezone)) {
        ctx.db.prepare('UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?').run(req.body.timezone, Date.now(), req.user.id);
      }
    }

    if (isAppearance) {
      const currentTheme = parseTheme(blog.theme);
      const next = validateTheme({
        accentColor: req.body.accent_color,
        backgroundKey: currentTheme.backgroundKey,
        backgroundHue: currentTheme.backgroundHue,
        // Старые формы без этих полей не должны сбрасывать выбор.
        tintMode: req.body.tint_mode ?? currentTheme.tintMode,
        tintColor: req.body.tint_color ?? currentTheme.tintColor,
        socials: currentTheme.socials,
      });
      ctx.db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), blog.id);
    }

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
        res.status(422);
        return renderSettings(req, res, blog, { error: ctx.translate(req, err.code) });
      }
      next(err);
    }
  });

  // Загрузка кастомного фона блога (картинка → media → theme.backgroundKey).
  // kind 'cover' — историческое имя ассета блога, фон показывается на всю страницу.
  router.post('/settings/blog/background', upload.single('background'), csrf.protection, async (req, res, next) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    try {
      if (!req.file) throw new MediaError('composer.errors.required_file');
      const limits = getUploadLimits(ctx.db);
      const buffer = await readTmpFile(req.file);
      const processed = await processUpload(buffer, 'cover', limits);
      const storageKey = await ctx.storage.save(processed.buffer);
      // Оттенок берём из самой картинки — по нему красится интерфейс страницы блога.
      const hue = await dominantHue(processed.buffer);
      // Старый фон удаляем из хранилища и из media (если запись была).
      const current = parseTheme(blog.theme);
      const old = current.backgroundKey;
      if (old && old !== storageKey) {
        await ctx.storage.remove(old);
        ctx.db.prepare('DELETE FROM media WHERE storage_key = ?').run(old);
      }
      ctx.db
        .prepare(
          `INSERT INTO media (owner_blog_id, kind, storage_key, mime_type, size, width, height, metadata, created_at)
           VALUES (?, 'cover', ?, ?, ?, ?, ?, '{}', ?)`
        )
        .run(blog.id, storageKey, processed.mime, processed.buffer.byteLength, processed.width, processed.height, Date.now());
      const merged = validateTheme({ accentColor: current.accentColor, backgroundKey: storageKey, backgroundHue: hue });
      ctx.db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), Date.now(), blog.id);
      res.redirect(303, '/settings/blog?saved=1');
    } catch (err) {
      await cleanupTmp(req.file ? [req.file] : []);
      if ((err instanceof MediaError || err instanceof FormError) && err.status === 422) {
        res.status(422);
        return renderSettings(req, res, blog, { error: ctx.translate(req, err.code) });
      }
      next(err);
    }
  });

  router.post('/settings/blog/background/remove', csrf.protection, async (req, res, next) => {
    const blog = getOwnBlog(req, res);
    if (!blog) return;
    const theme = parseTheme(blog.theme);
    if (theme.backgroundKey) {
      await ctx.storage.remove(theme.backgroundKey);
      ctx.db.prepare('DELETE FROM media WHERE storage_key = ?').run(theme.backgroundKey);
      const updated = validateTheme({ accentColor: theme.accentColor });
      ctx.db.prepare('UPDATE blogs SET theme = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(updated), Date.now(), blog.id);
    }
    res.redirect(303, '/settings/blog?saved=1');
  });

  return router;
}
