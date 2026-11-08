// Ограничители частоты запросов для чувствительных маршрутов.
// Memory store достаточен: приложение — один процесс (см. ADR-007).
import rateLimit from 'express-rate-limit';

function limiter(windowMs, limit, keyGenerator) {
  // В тестах ограничители отключены: общий memory-store по IP ломает массовые
  // регистрации и логины в рамках одного набора тестов.
  if (process.env.NODE_ENV === 'test') {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      res.status(429).send('Too Many Requests');
    },
  });
}

// Подбор: 10 попыток входа за 15 минут, 10 регистраций в час с одного IP.
export const loginLimiter = limiter(15 * 60 * 1000, 10);
export const registerLimiter = limiter(60 * 60 * 1000, 10);

// Ask box: для анонимов лимит по IP (5/час, ADR-018), для авторизованных — по user id (20/час).
const authedAskLimiter = limiter(60 * 60 * 1000, 20, (req) => `u${req.user?.id ?? 0}`);
const anonAskLimiter = limiter(60 * 60 * 1000, 5);

export const askLimiter = (req, res, next) => {
  const chosen = req.user ? authedAskLimiter : anonAskLimiter;
  chosen(req, res, next);
};

// Жалобы: не более 10 в час с одного источника.
export const reportLimiter = limiter(60 * 60 * 1000, 10);
