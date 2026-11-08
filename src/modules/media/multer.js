// Приём загрузок: multer пишет во временный каталог, содержимое проверяется отдельно
// по magic bytes. Имена файлов клиента не используются нигде.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

const HARD_FILE_SIZE_CAP = 130 * 1024 * 1024; // жёсткий потолок; точные лимиты — по типам в validate.js
const HARD_FILES_CAP = 12;

export function createMulter(ctx) {
  fs.mkdirSync(ctx.config.uploadsTmpDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, ctx.config.uploadsTmpDir),
      filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
    }),
    limits: { fileSize: HARD_FILE_SIZE_CAP, files: HARD_FILES_CAP },
    // fileFilter не смотрит на имя/тип клиента: реальные байты проверяет processUpload.
    fileFilter: (_req, _file, cb) => cb(null, true),
  });
}

export async function readTmpFile(file) {
  return fsp.readFile(file.path);
}

export async function cleanupTmp(files) {
  await Promise.all((files ?? []).map((f) => fsp.rm(f.path, { force: true }).catch(() => {})));
}

export function tmpDirCleanup(ctx) {
  // Периодическая чистка временных файлов, оставшихся от прерванных запросов.
  return setInterval(
    () => {
      fs.readdir(ctx.config.uploadsTmpDir, (err, names) => {
        if (err) return;
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const name of names) {
          const full = path.join(ctx.config.uploadsTmpDir, name);
          fs.stat(full, (err2, stat) => {
            if (!err2 && stat.mtimeMs < cutoff) fsp.rm(full, { force: true }).catch(() => {});
          });
        }
      });
    },
    30 * 60 * 1000
  );
}
