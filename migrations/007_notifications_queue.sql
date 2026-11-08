-- Уведомления и очередь публикаций (Этап 7).
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- follow | like | reblog | comment | ask | moderation
  type TEXT NOT NULL,
  actor_blog_id INTEGER REFERENCES blogs(id) ON DELETE SET NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  ask_id INTEGER REFERENCES asks(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Антидубликаты: выраженный индекс с COALESCE — NULL в UNIQUE в SQLite всегда «различен»,
-- поэтому дедупликация делается отдельным уникальным индексом.
CREATE UNIQUE INDEX idx_notifications_unique ON notifications(
  type,
  COALESCE(actor_blog_id, 0),
  COALESCE(post_id, 0),
  COALESCE(ask_id, 0),
  user_id
);

-- Публикации из очереди: момент постановки в очередь для порядка выдачи.
ALTER TABLE posts ADD COLUMN queued_at INTEGER;
