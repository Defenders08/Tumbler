-- Поиск (FTS5) и Ask box (Этап 6).
CREATE TABLE asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','answered','ignored','deleted')),
  answer_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_asks_blog ON asks(blog_id, status, created_at);

-- Полнотекстовый индекс: unicode61 корректно токенизирует кириллицу (porter бесполезен для русского).
-- Содержимое строки — склеенный текст (заголовок, тело, теги), синхронизируется из кода приложения.
CREATE VIRTUAL TABLE posts_fts USING fts5(text, post_id UNINDEXED, tokenize = 'unicode61');

CREATE VIRTUAL TABLE blogs_fts USING fts5(text, blog_id UNINDEXED, tokenize = 'unicode61');
