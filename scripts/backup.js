#!/usr/bin/env node
// Резервное копирование Tumbler: снапшот SQLite (онлайн, без остановки) + медиафайлы.
// Использование: node scripts/backup.js [каталог-назначения]
// По умолчанию: ./backups/tumbler-YYYYMMDD-HHMMSS/
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';

const config = (await import('../src/config.js')).default;
const destRoot = process.argv[2] ?? path.join(config.dataDir, '..', 'backups');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.resolve(destRoot, `tumbler-${stamp}`);
fs.mkdirSync(dest, { recursive: true });

// 1. Снапшот SQLite: безопасен при работающем сервере (WAL).
const db = openDatabase(config.dbPath);
const dbDest = path.join(dest, 'tumbler.db');
await db.backup(dbDest);
db.close();
console.log('база:', dbDest);

// 2. Медиафайлы.
const uploadsDest = path.join(dest, 'uploads');
if (fs.existsSync(config.uploadsDir)) {
  await fsp.cp(config.uploadsDir, uploadsDest, { recursive: true });
  console.log('медиа:', uploadsDest);
}

// 3. Размер и подсказка по восстановлению.
const { execSync } = await import('node:child_process');
const size = execSync(`du -sh "${dest}" | cut -f1`).toString().trim();
console.log(`готово: ${dest} (${size})`);
console.log('восстановление: остановите сервер, замените tumbler.db и uploads/ в data/, запустите сервер (см. docs/deploy.md)');
