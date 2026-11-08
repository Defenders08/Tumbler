-- Блоги: один блог на аккаунт (Этап 2).
CREATE TABLE blogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Тема блога: JSON с цветами и шрифтом; '{}' означает стандартную тему.
  theme TEXT NOT NULL DEFAULT '{}',
  ask_enabled INTEGER NOT NULL DEFAULT 1,
  ask_anonymous INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
