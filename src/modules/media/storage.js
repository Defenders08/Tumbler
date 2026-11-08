// Локальное файловое хранилище. Интерфейс save/resolvePath/remove позволяет
// позже заменить реализацию на S3-compatible хранилище (ADR-008), не меняя остальной код.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function createLocalStorage(uploadsDir) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  return {
    // Ключ случайный, оригинальные имена файлов в путях не используются.
    // Расширение намеренно не сохраняется: тип файла отдаётся из БД (nosniff).
    async save(buffer) {
      const key = crypto.randomBytes(16).toString('hex');
      const dir = path.join(uploadsDir, key.slice(0, 2));
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, key), buffer, { mode: 0o644 });
      return key;
    },
    // Ключ строго hex32 — path traversal исключён конструктивно.
    resolvePath(key) {
      if (typeof key !== 'string' || !/^[0-9a-f]{32}$/.test(key)) return null;
      return path.join(uploadsDir, key.slice(0, 2), key);
    },
    async remove(key) {
      const full = this.resolvePath(key);
      if (!full) return;
      await fsp.rm(full, { force: true });
      try {
        await fsp.rmdir(path.dirname(full));
      } catch {
        // каталог не пуст — это нормально
      }
    },
  };
}
