// Обработка ошибок: единая точка для 404, CSRF, multer, сбоев рендера.
import { translate } from '../lib/i18n.js';

export function notFoundHandler(ctx) {
  return (req, res) => {
    if (wantsJson(req)) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    }
    res.status(404).render('pages/errors/error', {
      title: translate(req.lang, 'errors.404_title'),
      errorText: translate(req.lang, 'errors.404_text'),
    });
  };
}

export function errorHandler(ctx, csrfInvalidError) {
  // eslint-disable-next-line no-unused-vars — four-argument signature обязателен для Express
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    ctx.log.error(err?.stack || err?.message || String(err));

    let status = err?.status ?? err?.statusCode ?? 500;
    let titleKey = 'errors.500_title';
    let textKey = 'errors.500_text';

    if (err === csrfInvalidError) {
      status = 403;
      titleKey = 'errors.403_title';
      textKey = 'errors.403_text';
    } else if (err?.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      titleKey = 'errors.413_title';
      textKey = 'errors.413_text';
    } else if (status === 404) {
      titleKey = 'errors.404_title';
      textKey = 'errors.404_text';
    }

    if (wantsJson(req)) {
      return res.status(status).json({ error: { code: err?.code ?? null, message: translate(req.lang, textKey) } });
    }

    try {
      res.status(status).render('pages/errors/error', {
        title: translate(req.lang, titleKey),
        errorText: translate(req.lang, textKey),
      });
    } catch (renderErr) {
      ctx.log.error('сбой рендера страницы ошибки:', renderErr.message);
      res.status(status).send(translate(req.lang, textKey));
    }
  };
}

function wantsJson(req) {
  return req.path.startsWith('/api/');
}
