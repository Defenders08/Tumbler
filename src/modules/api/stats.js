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
