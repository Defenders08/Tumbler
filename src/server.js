// Точка входа Tumbler: БД, миграции, seed админа, HTTP-сервер, фоновые задачи.
import config from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { log } from './lib/logger.js';
import { createApp } from './app.js';
import { seedAdmin } from './modules/auth/service.js';
import { purgeExpiredSessions } from './modules/auth/session.js';
import { tmpDirCleanup } from './modules/media/multer.js';
import { startScheduler } from './scheduler/index.js';

const db = openDatabase(config.dbPath);
const applied = migrate(db);
if (applied > 0) log.info(`применено миграций: ${applied}`);

const ctx = { config, db, log };
await seedAdmin(ctx, config, log);
purgeExpiredSessions(ctx);

const app = createApp(ctx);
const server = app.listen(config.port, () => {
  log.info(`Tumbler запущен: http://localhost:${config.port} (${config.env})`);
});

// Планировщик публикаций: догон пропущенного при старте + тик раз в 30 секунд.
startScheduler(db);

// Фоновые задачи: чистка сессий раз в сутки, временных файлов — раз в полчаса.
setInterval(() => purgeExpiredSessions(ctx), 24 * 60 * 60 * 1000).unref();
tmpDirCleanup(ctx).unref();

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`получен ${signal}, останавливаюсь…`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => {
    db.close();
    process.exit(1);
  }, 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
