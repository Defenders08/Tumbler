// Раннер миграций: применяет migrations/*.sql по порядку, идемпотентно, в транзакции.
// Работает и как CLI (npm run migrate), и как функция при старте сервера.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { log } from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const migrationsDir = path.resolve(__dirname, '../../migrations');

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const applied = new Set(db.prepare('SELECT version FROM migrations').all().map((r) => r.version));
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // SQL-файлы миграций не должны содержать собственных BEGIN/COMMIT — транзакцией управляет раннер.
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)').run(file, Date.now());
    });
    run();
    log.info('миграция применена:', file);
    appliedCount += 1;
  }
  return appliedCount;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const { default: config } = await import('../config.js');
  const { openDatabase } = await import('./connection.js');
  const db = openDatabase(config.dbPath);
  const n = migrate(db);
  log.info(n === 0 ? 'все миграции уже применены' : `применено миграций: ${n}`);
  db.close();
}
