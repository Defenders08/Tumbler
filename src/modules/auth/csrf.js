// CSRF-защита: csrf-csrf (signed double-submit, OWASP).
// Токен отдаётся в мета-теге и скрытом поле форм; для JSON API — заголовок x-csrf-token.
import { doubleCsrf } from 'csrf-csrf';
import { log } from '../../lib/logger.js';

export const CSRF_COOKIE = 'tumbler.csrf';

export function setupCsrf(config) {
  const utils = doubleCsrf({
    getSecret: () => config.sessionSecret,
    // Привязка токена к сессии: до входа — sid гостя (пусто), после — id пользователя.
    getSessionIdentifier: (req) => String(req.user?.id ?? req.cookies?.['tumbler.sid'] ?? ''),
    cookieName: CSRF_COOKIE,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.isProduction,
      path: '/',
    },
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getCsrfTokenFromRequest: (req) => {
      // Явный выбор источника по типу запроса, без «тихих» fallback'ов:
      // JSON API и запросы без тела (fetch) — только заголовок;
      // HTML-формы (urlencoded/multipart всегда имеют content-type) — только поле _csrf.
      const contentType = req.headers['content-type'] ?? '';
      if (contentType === '' || contentType.includes('application/json')) {
        const header = req.headers['x-csrf-token'];
        return typeof header === 'string' ? header : null;
      }
      const field = req.body?._csrf;
      return typeof field === 'string' ? field : null;
    },
  });

  // На всех GET-страницах генерируем (или переиспользуем) токен для шаблонов.
  const exposeToken = (req, res, next) => {
    try {
      res.locals.csrfToken = utils.generateCsrfToken(req, res);
    } catch (err) {
      // Токен не критичен для отдачи страницы: POST всё равно будет отклонён без него.
      log.warn('не удалось сгенерировать CSRF-токен:', err.message);
    }
    next();
  };

  // Проверка для мутирующих маршрутов; вызывается ПОСЛЕ парсеров тела (и multer).
  // Внимание: validateRequest в csrf-csrf v4 ВОЗВРАЩАЕТ boolean, а не бросает исключение.
  const protection = (req, res, next) => {
    if (!utils.validateRequest(req)) {
      return next(utils.invalidCsrfTokenError);
    }
    next();
  };

  return { utils, exposeToken, protection };
}
