// Чтение/запись системных настроек (таблица settings, значения в JSON).
export function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}

export function getUploadLimits(db) {
  return getSetting(db, 'upload_limits', {
    image: 10 * 1024 * 1024,
    gif: 10 * 1024 * 1024,
    audio: 20 * 1024 * 1024,
    video: 100 * 1024 * 1024,
    maxFilesPerPost: 10,
  });
}
