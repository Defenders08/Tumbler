// Конфигурация приложения: окружение, пути, секреты.
// Значения берутся из переменных окружения; в разработке действуют безопасные дефолты.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');

function readStoredDevSecret(dataDir) {
  // В разработке секрет сессии хранится в data/, чтобы сессии переживали рестарт.
  try {
    const value = fs.readFileSync(path.join(dataDir, 'session-secret'), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

const env = process.env.NODE_ENV ?? 'development';
const isProduction = env === 'production';

const dataDir = path.resolve(projectRoot, process.env.DATA_DIR ?? './data');
fs.mkdirSync(dataDir, { recursive: true });

let sessionSecret = process.env.SESSION_SECRET ?? null;
if (!sessionSecret && !isProduction) {
  const stored = readStoredDevSecret(dataDir);
  if (stored) {
    sessionSecret = stored;
  } else {
    sessionSecret = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(path.join(dataDir, 'session-secret'), sessionSecret, { mode: 0o600 });
  }
}
if (!sessionSecret) {
  throw new Error('SESSION_SECRET обязателен в production — задайте его в .env (openssl rand -base64 48)');
}

const config = {
  env,
  isProduction,
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ? path.resolve(projectRoot, process.env.DB_PATH) : path.join(dataDir, 'tumbler.db'),
  dataDir,
  uploadsDir: process.env.UPLOAD_DIR ? path.resolve(projectRoot, process.env.UPLOAD_DIR) : path.join(dataDir, 'uploads'),
  uploadsTmpDir: path.join(dataDir, 'uploads-tmp'),
  sessionSecret,
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  adminEmail: process.env.ADMIN_EMAIL || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,
  defaultLocale: process.env.DEFAULT_LOCALE === 'en' ? 'en' : 'ru',
};

export default config;
