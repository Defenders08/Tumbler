-- Кастомная шапка-баннер заменена кастомным фоном на всю страницу.
-- Ключ темы bannerKey переименовывается в backgroundKey; старые значения переносятся.
UPDATE blogs
SET theme = json_set(
  json_remove(theme, '$.bannerKey'),
  '$.backgroundKey',
  json_extract(theme, '$.bannerKey')
)
WHERE json_valid(theme)
  AND json_extract(theme, '$.bannerKey') IS NOT NULL;
