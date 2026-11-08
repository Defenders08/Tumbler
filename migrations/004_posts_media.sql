-- Медиа, посты всех семи типов, теги (Этап 4).
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_blog_id INTEGER REFERENCES blogs(id) ON DELETE SET NULL,
  -- kind: image | gif | video | audio | cover | avatar
  kind TEXT NOT NULL CHECK (kind IN ('image','gif','video','audio','cover','avatar')),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

-- Аватар блога ссылается на media; колонка добавляется после создания таблицы media.
ALTER TABLE blogs ADD COLUMN avatar_media_id INTEGER REFERENCES media(id);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text','photo','quote','link','audio','video','gif')),
  -- Общие текстовые поля (смысл зависит от типа; см. src/modules/posts):
  title TEXT,
  body TEXT,
  body_html TEXT,
  quote_text TEXT,
  link_url TEXT,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','queued','scheduled','published','hidden','deleted')),
  nsfw INTEGER NOT NULL DEFAULT 0,
  -- Реблоги (этап 5): корень и прямой родитель цепочки.
  reblog_root_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  reblog_parent_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  published_at INTEGER,
  scheduled_at INTEGER,
  like_count INTEGER NOT NULL DEFAULT 0,
  reblog_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_posts_feed ON posts(status, published_at DESC);
CREATE INDEX idx_posts_blog ON posts(blog_id, status, published_at DESC);
CREATE INDEX idx_posts_type ON posts(type);

-- Связь поста с его медиафайлами (порядок задаётся position).
CREATE TABLE post_media (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL UNIQUE REFERENCES media(id),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id)
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);
