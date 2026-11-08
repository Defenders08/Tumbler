// Сервис аккаунтов: регистрация, аутентификация, seed администратора.
// argon2 асинхронный, better-sqlite3 — синхронный: хешируем до транзакции,
// целостность страхуют UNIQUE-ограничения базы.
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { z } from 'zod';
import { translate } from '../../lib/i18n.js';
import { syncBlog } from '../search/service.js';

export class FormError extends Error {
  constructor(code, { status = 422, params } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

// Ключи ошибок совпадают с ключами в локализации (src/locales/*.json).
export function errorMessage(lang, error) {
  if (error instanceof FormError) return translate(lang, error.code, error.params);
  return translate(lang, 'errors.500_text');
}

const emailSchema = z.email({ error: 'auth.errors.bad_email' }).max(200);
const passwordSchema = z.string().min(8, 'auth.errors.weak_password').max(200);
const slugSchema = z.string().regex(/^[a-z0-9-]{3,32}$/, 'auth.errors.bad_slug');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  slug: slugSchema,
  title: z.string().max(100).optional().transform((v) => (v || '').trim()),
  locale: z.enum(['ru', 'en']).catch('ru'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'auth.errors.required').max(200),
});

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new FormError(result.error.issues[0].message, { status: 422 });
  }
  return result.data;
}

// type — фирменная константа argon2 (в v0.45 строка не принимается).
const hashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

function insertUserWithBlog(ctx, { email, hash, role = 'user', locale = 'ru', slug, title }, now) {
  return ctx.db.transaction(() => {
    const info = ctx.db
      .prepare(
        `INSERT INTO users (email, password_hash, role, status, locale, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(email, hash, role, locale, now, now);
    const userId = info.lastInsertRowid;
    ctx.db
      .prepare(
        `INSERT INTO blogs (user_id, slug, title, description, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?)`
      )
      .run(userId, slug, title, now, now);
    const blog = ctx.db.prepare('SELECT id FROM blogs WHERE user_id = ?').get(userId);
    syncBlog(ctx.db, blog.id);
    return ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  })();
}

// Регистрация: пользователь + один блог с уникальным slug.
export async function registerUser(ctx, data) {
  const { email, password, slug, title, locale } = validate(registerSchema, data);

  const emailTaken = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (emailTaken) throw new FormError('auth.errors.email_taken');
  const slugTaken = ctx.db.prepare('SELECT id FROM blogs WHERE slug = ?').get(slug);
  if (slugTaken) throw new FormError('auth.errors.slug_taken');

  const hash = await argon2.hash(password, hashOptions);
  const now = Date.now();
  try {
    return insertUserWithBlog(ctx, { email, hash, locale, slug, title: title || slug }, now);
  } catch (err) {
    // Гонка с параллельной регистрацией: UNIQUE-ограничения — последняя линия защиты.
    if (String(err.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      if (ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        throw new FormError('auth.errors.email_taken');
      }
      throw new FormError('auth.errors.slug_taken');
    }
    throw err;
  }
}

export async function authenticateUser(ctx, data) {
  const { email, password } = validate(loginSchema, data);
  const user = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const hash = user ? user.password_hash : FALLBACK_HASH;
  // Одинаковый путь при существующем и несуществующем пользователе — без утечки по времени.
  const ok = await argon2.verify(hash, password);
  if (!user || !ok) throw new FormError('auth.login.invalid', { status: 422 });
  if (user.status === 'blocked') throw new FormError('auth.login.blocked', { status: 423 });
  return user;
}

// Фиктивный хеш для проверки несуществующих пользователей (тот же формат и параметры).
const FALLBACK_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// Seed администратора из переменных окружения: создаётся, если админа ещё нет.
export async function seedAdmin(ctx, config, log) {
  if (!config.adminEmail || !config.adminPassword) return;
  const existing = ctx.db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (existing) return;

  const { email, password } = validate(
    z.object({ email: emailSchema, password: passwordSchema }),
    { email: config.adminEmail, password: config.adminPassword }
  );
  const hash = await argon2.hash(password, hashOptions);
  const now = Date.now();
  const slug = `admin-${crypto.randomBytes(3).toString('hex')}`;

  try {
    insertUserWithBlog(ctx, { email, hash, role: 'admin', slug, title: 'Admin' }, now);
    log.info(`создан администратор ${email} (из переменных окружения)`);
  } catch (err) {
    if (String(err.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      log.warn('seed администратора: конфликт уникальности — пропущен');
      return;
    }
    throw err;
  }
}
