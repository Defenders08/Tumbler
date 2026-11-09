// Статистика (Этап 9): просмотры постов и агрегаты блогов.
// Сбор — только необходимые данные, без внешних сервисов (ТЗ 7.5).
export function recordView(db, postId, visitor) {
  const day = new Date().toISOString().slice(0, 10);
  const info = db
    .prepare('INSERT OR IGNORE INTO post_views_daily (post_id, day, visitor) VALUES (?, ?, ?)')
    .run(postId, day, String(visitor).slice(0, 64));
  if (info.changes > 0) {
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(postId);
  }
}

export function viewsForPost(db, postId) {
  return db.prepare('SELECT COUNT(*) AS n FROM post_views_daily WHERE post_id = ?').get(postId).n;
}

export function blogStats(db, blogId) {
  const one = (sql) => db.prepare(sql).get(blogId).n;
  return {
    posts: one("SELECT COUNT(*) AS n FROM posts WHERE blog_id = ? AND status = 'published'"),
    likes: one('SELECT COALESCE(SUM(like_count), 0) AS n FROM posts WHERE blog_id = ?'),
    reblogs: one('SELECT COALESCE(SUM(reblog_count), 0) AS n FROM posts WHERE blog_id = ?'),
    comments: one('SELECT COALESCE(SUM(comment_count), 0) AS n FROM posts WHERE blog_id = ?'),
    views: one('SELECT COALESCE(SUM(view_count), 0) AS n FROM posts WHERE blog_id = ?'),
    followers: db.prepare('SELECT COUNT(*) AS n FROM follows WHERE blog_id = ?').get(blogId).n,
  };
}

// Топ постов блога по просмотрам (для страницы статистики владельца).
export function topPostsByViews(db, blogId, limit = 5) {
  return db
    .prepare(
      `SELECT id, type, title, body, view_count, like_count, reblog_count, comment_count
       FROM posts WHERE blog_id = ? AND status = 'published'
       ORDER BY view_count DESC, id DESC LIMIT ?`
    )
    .all(blogId, limit)
    .map((p) => ({ ...p, excerpt: (p.title || p.body || '').slice(0, 80) }));
}

// Серии по дням за последние N дней (для графиков статистики).
function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function viewsSeries(db, blogId, days = 30) {
  const rows = db
    .prepare(
      `SELECT v.day AS day, SUM(v.cnt) AS n
       FROM (
         SELECT post_id, day, COUNT(*) AS cnt FROM post_views_daily
         GROUP BY post_id, day
       ) v
       JOIN posts p ON p.id = v.post_id
       WHERE p.blog_id = ? AND v.day >= ?
       GROUP BY v.day ORDER BY v.day`
    )
    .all(blogId, dayKey(Date.now() - (days - 1) * 86400000));
  return fillDays(rows, days);
}

export function likesSeries(db, blogId, days = 30) {
  // Группируем по дате из epoch (created_at в мс).
  const raw = db
    .prepare(
      `SELECT date(l.created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
       FROM likes l JOIN posts p ON p.id = l.post_id
       WHERE p.blog_id = ? AND l.created_at >= ?
       GROUP BY day ORDER BY day`
    )
    .all(blogId, Date.now() - (days - 1) * 86400000);
  return fillDays(raw, days);
}

// Заполняет пропущенные дни нулями: [{day, n}] длиной days.
function fillDays(rows, days) {
  const map = new Map(rows.map((r) => [r.day, r.n]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, n: map.get(key) ?? 0 });
  }
  return out;
}

// SVG polyline-график: ширина 560, высота 120, без библиотек.
export function svgChart(series, { width = 560, height = 120, color = '#5791bb' } = {}) {
  const max = Math.max(1, ...series.map((p) => p.n));
  const pad = 6;
  const step = (width - pad * 2) / Math.max(1, series.length - 1);
  const y = (n) => height - pad - (n / max) * (height - pad * 2);
  const points = series.map((p, i) => `${(pad + i * step).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  const dotX = pad + (series.length - 1) * step;
  return {
    points,
    max,
    width,
    height,
    color,
    dotX: dotX.toFixed(1),
    dotY: y(last.n).toFixed(1),
    total: last.n,
  };
}
