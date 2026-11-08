-- Просмотры постов (Этап 9): агрегат по дням и посетителям.
-- Дедупликация: один посетитель (cookie) считаетcя один раз в сутки на пост.
CREATE TABLE post_views_daily (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (post_id, day, visitor)
);

CREATE INDEX idx_views_post ON post_views_daily(post_id);
