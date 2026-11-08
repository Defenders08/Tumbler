-- Системные настройки и стартовые значения лимитов загрузок (байт).
-- Администратор меняет их через админ-панель (этап 8); пока значения фиксированы миграцией.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('upload_limits', '{"image":10485760,"gif":10485760,"audio":20971520,"video":104857600,"maxFilesPerPost":10}'),
  ('registration_open', 'true');
