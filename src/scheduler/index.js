// Планировщик публикаций (Этап 7): отложенные по времени и очередь.
// Состояние живёт в SQLite — переживает рестарт; тикер запускается при старте
// и раз в 30 секунд. Публикация атомарна по status-условию: дублей не бывает.
// Часовые пояса: в базе только UTC (epoch); пользовательский ввод — в его зоне.
import { syncPost } from '../modules/search/service.js';
import { log } from '../lib/logger.js';

// Интервал очереди: не чаще одного поста раз в 30 минут на блог.
export const QUEUE_INTERVAL_MS = 30 * 60 * 1000;

// Смещение часового пояса в миллисекундах для конкретного момента UTC.
function timezoneOffsetMs(utcMs, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    const part = fmt.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName');
    // Формат «GMT+03:00» / «GMT-04:30» / «GMT»
    const m = part?.value?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    return sign * ((Number(m[2]) * 60 + Number(m[3])) * 60 * 1000);
  } catch {
    return 0;
  }
}

// «YYYY-MM-DDTHH:mm» в зоне пользователя -> epoch UTC.
export function localToUtcEpoch(localString, timeZone) {
  const asUtc = new Date(`${localString}Z`).getTime();
  if (Number.isNaN(asUtc)) return NaN;
  return asUtc - timezoneOffsetMs(asUtc, timeZone);
}

// Публикация плановых постов, чей час настал. Возвращает количество опубликованных.
export function publishScheduled(db) {
  const now = Date.now();
  const due = db
    .prepare("SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC")
    .all(now);
  let count = 0;
  for (const { id } of due) {
    // Атомарный захват: условие по статусу гарантирует однократную публикацию.
    const result = db
      .prepare(
        "UPDATE posts SET status = 'published', published_at = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'"
      )
      .run(now, now, id);
    if (result.changes > 0) {
      syncPost(db, id);
      count += 1;
    }
  }
  return count;
}

// Очередь: по одному посту на блог, не чаще QUEUE_INTERVAL_MS.
export function publishQueued(db) {
  const now = Date.now();
  const blogs = db.prepare("SELECT DISTINCT blog_id FROM posts WHERE status = 'queued'").all();
  let count = 0;
  for (const { blog_id } of blogs) {
    const last = db
      .prepare(
        `SELECT MAX(published_at) AS last FROM posts
         WHERE blog_id = ? AND status = 'published' AND queued_at IS NOT NULL`
      )
      .get(blog_id).last;
    if (last && now - last < QUEUE_INTERVAL_MS) continue;
    const next = db
      .prepare(
        "SELECT id FROM posts WHERE blog_id = ? AND status = 'queued' ORDER BY queued_at ASC, id ASC LIMIT 1"
      )
      .get(blog_id);
    if (!next) continue;
    const result = db
      .prepare(
        "UPDATE posts SET status = 'published', published_at = ?, updated_at = ?, queued_at = queued_at WHERE id = ? AND status = 'queued'"
      )
      .run(now, now, next.id);
    if (result.changes > 0) {
      syncPost(db, next.id);
      count += 1;
    }
  }
  return count;
}

export function tick(db) {
  const scheduled = publishScheduled(db);
  const queued = publishQueued(db);
  if (scheduled + queued > 0) {
    log.info(`планировщик: опубликовано ${scheduled} по расписанию, ${queued} из очереди`);
  }
  return { scheduled, queued };
}

// Запуск тикера при старте сервера: догон пропущенного + интервал.
export function startScheduler(db) {
  tick(db);
  return setInterval(() => {
    try {
      tick(db);
    } catch (err) {
      log.error('ошибка тикера планировщика:', err.message);
    }
  }, 30_000);
}
