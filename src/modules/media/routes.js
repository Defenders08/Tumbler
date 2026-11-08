// Маршруты медиа: отдача файлов по случайному ключу из БД.
import { Router } from 'express';

export function mediaRoutes(ctx) {
  const router = Router();

  router.get('/media/:key', (req, res) => {
    const row = ctx.db.prepare('SELECT * FROM media WHERE storage_key = ?').get(req.params.key);
    const full = row ? ctx.storage.resolvePath(row.storage_key) : null;
    if (!row || !full) {
      return res.status(404).send('Not found');
    }
    // nosniff + известный mime из БД: загруженные файлы не могут исполниться как HTML/JS.
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(row.mime_type);
    return res.sendFile(full);
  });

  return router;
}
