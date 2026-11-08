-- Модерация (Этап 8): жалобы, пользовательские блокировки, журнал действий модераторов.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','blog')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam','abuse','nsfw','other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_reports_status ON reports(status, created_at);

-- Пользовательские блокировки: заблокированный не может взаимодействовать
-- с блокировщиком (лайк/комментарий/реблог/подписка).
CREATE TABLE blocks (
  blocker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);

CREATE INDEX idx_blocks_blocked ON blocks(blocked_user_id);

-- Журнал действий модераторов (требование ТЗ 6.1).
CREATE TABLE moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_moderation_actions_time ON moderation_actions(created_at DESC);
