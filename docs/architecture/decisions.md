# Архитектурные решения Tumbler

**Статус:** Этап 0. Основание: docs/research/open-source-review.md (состояние на 11.2026), ТЗ разделы 6–9.
**Формат:** краткие ADR. Статус: принято / отложено.

## Принятые решения

### ADR-001. Платформа и версия Node.js — Node.js 24 LTS
better-sqlite3@13 (N-API) и file-type@22 требуют Node ≥22. Проект целиком на **ESM** (`"type": "module"`) — уточнение к исследованию: file-type ESM-only, и единый модульный стиль проще динамических import(). Фактическая разработка идёт на Node 26.5 (Current), CI-цель — Node 24 LTS. *(Альтернативы: Node 22 — Maintenance LTS, приемлем.)*

### ADR-002. HTTP-фреймворк — Express 5
Простой, всем знакомый, MIT. Fastify (плагинная архитектура, JSON Schema) избыточен для монолита с SSR. Роуты группируются по доменам, единый error-handler.

### ADR-003. БД — SQLite через better-sqlite3@13, режим WAL
Синхронный API идеален для монолита (нет пула и колбэков). WAL включается при инициализации. Тяжёлая обработка файлов — вне транзакций. Признаки миграции на PostgreSQL (зафиксированы, не реализуются): >1 писателя-процесса, sustained write-конфликты, потребность в полноценном стемминге русского, многотерабайтные объёмы.

### ADR-004. Миграции — самописный SQL-раннер
Каталог `migrations/NNN_name.sql` (вверх; вниз — ручные, редко нужны), таблица `migrations(version, applied_at)`, применение в транзакции при старте приложения. Сохранение пользовательских данных обязательно.

### ADR-005. Рендеринг — liquidjs, серверный SSR + точечный vanilla JS
Гибридный интерфейс по ТЗ: страницы рендерятся сервером; динамические действия (лайк, реблог, follow, комментарии, счётчики) — fetch на JSON-API с обновлением DOM без перезагрузки. Клиентский JS — нативные ES-модули, **без бандлера и фреймворков**. liquidjs выбран из-за наследования шаблонов (`{% layout %}`) и активной поддержки (nunjucks дремлет с 2023).

### ADR-006. Аутентификация — argon2id + серверные сессии в SQLite
Пароли: argon2 (memory-hard, OWASP). Сессии: таблица `sessions` (требование ТЗ и модерации): id — 32 случайных байта (base64url), cookie `httpOnly; sameSite=strict; secure` в production; своя реализация store на better-sqlite3 (~50 строк). Почтовые функции отсутствуют, но регистрация/сброс пароля изолированы в модуле auth, чтобы добавить письма позже (по ТЗ). Никаких фиктивных «писем отправлено».

### ADR-007. CSRF и rate limiting — csrf-csrf + express-rate-limit
CSRF: signed double-submit cookie (OWASP) на все мутирующие POST/PUT/DELETE. Урок внедрения: в csrf-csrf v4 `validateRequest()` **возвращает boolean**, а не бросает исключение — обёртка обязана проверять возвращаемое значение (это поймали автотесты). Источник токена выбирается явно по типу запроса: JSON — заголовок `x-csrf-token`, формы — поле `_csrf`. Для multipart multer стоит ДО CSRF-проверки, чтобы поле `_csrf` было разобрано. Rate limit (memory-store, один процесс): вход 10/15мин, регистрация 10/час; в `NODE_ENV=test` ограничители отключены (общий memory-store по IP ломает массовые сценарии тестов).

### ADR-008. Загрузки и медиа — multer@2.5 + file-type + sharp, локальное FS-хранилище
Абстракция `Storage` (интерфейс: `put/read/remove/stat`) с реализацией `LocalStorage`; S3-compatible — замена без изменения остального кода (по ТЗ, не обязательна). Файлы: `data/uploads/<aa>/<key>` (key — случайный, оригинальные имена не сохраняются в путях; path traversal исключён), отдаются через роут `/media/:key` с `X-Content-Type-Options: nosniff` и `Content-Disposition` по типу. Проверки: multer limits → file-type по magic bytes → whitelist MIME (jpeg/png/webp/gif/mp4/webm/ogg/mp3/m4a) → переконтроль sharp для изображений/GIF. Лимиты размера/количества — в таблице `settings`, редактируются в админке. sharp: max-размер изображения, генерация превью; GIF не перекодируются (сохраняется анимация), только метаданные и лимит. Видео/аудио хранятся как есть (без ffmpeg на старте).

### ADR-009. Разметка постов — markdown + sanitize при рендере
Хранится markdown-источник (posts.body). Рендер: `markdown-it({html:false})` → `sanitize-html` с allowlist → кеш отрендеренного HTML (posts.body_html) при сохранении. Пользовательский CSS блогов: только страница публичного блога, строгий CSP `script-src 'self'`, санитизация опасных конструкций (@import, url(javascript:)).

### ADR-010. Поиск — SQLite FTS5 (unicode61) + префиксы + LIKE-фолбэк
FTS5-таблицы для постов (title/body/tags) и блогов (title/description/slug). Пользовательский ввод нормализуется: термы → `терм*`; запросы <3 символов или с ошибкой FTS → `LIKE '%терм%'`. Porter не используется (только английский). Фильтр по типу поста, NSFW-фильтрация по настройкам.

### ADR-011. Планировщик публикаций — собственная очередь в SQLite
Таблица отложенных постов (status=scheduled/queued, publish_at в UTC). Тикер: setInterval 30с; атомарный захват работы `UPDATE ... WHERE status='scheduled' AND publish_at<=? RETURNING` в транзакции; после рестарта — догон пропущенного при старте. Один пост публикуется ровно один раз. Пользователь задаёт время в своей зоне (настройка timezone аккаунта), хранится UTC. node-cron — только для служебной периодики (бэкапы, чистка сессий).

### ADR-012. i18n — свой словарь JSON (ru/en)
`locales/ru.json`, `locales/en.json`, `t(key, lang)` + русская плюрализация (3 формы, ~20 строк). Язык — из настройки аккаунта / Accept-Language для гостей. liquidjs-фильтр `t`.

### ADR-013. Время — UTC в БД, Intl для отображения
Все timestamps — INTEGER (epoch ms) UTC. Отображение — `Intl.DateTimeFormat(locale, { timeZone })`. Настройка timezone пользователя влияет на отображение и ввод времени планирования.

### ADR-014. Валидация — zod на сервере
Схемы для форм и API-входа; клиентская валидация — дублирующая, не доверенная. Ошибки API — единый формат `{ error: { code, message, fields? } }`.

### ADR-015. API — REST `/api/v1`, документация OpenAPI
Страницы SSR и API живут в одном процессе; API покрывает: аккаунты, блоги, посты (7 типов, CRUD + черновики/расписание), теги, поиск, подписки, лайки, реблоги, комментарии, ask, уведомления, модерацию, статистику. Спека — `docs/api/openapi.yaml` (этап 9). Права всегда на сервере.

### ADR-016. Аналитика — собственные счётчики
`post_views_daily(post_id, day, count)` — upsert при просмотре (dedupe по cookie/session за сутки), агрегаты платформы считаются SQL-запросами по существующим таблицам. Без внешних сервисов, без персональных данных сверх необходимого.

### ADR-017. Иконки — собственный SVG-набор
Все иконки (7 типов постов, действия, интерфейс) — свои SVG. Ассеты Tumblr не копируются. Стиль — плоская пиктография в духе 2012 (см. design-spec.md §7).

### ADR-018. Анонимные Ask-вопросы — реализовать (решение делегировано исследованию)
Владелец блога включает анонимные вопросы; аноним ограничен rate limit'ом (по IP+сессии, ~5/час, конфигурируемо); ответ на анонимный вопрос — только публичный пост. Механика повторяет проверенное поведение Tumblr 2012–2014 (tumblr-2012.md §10).

### ADR-019. Реблоги — пост со ссылкой на корень
Реблог — строка в `posts` (type наследуется от корня, body — добавленный текст, `reblog_root_id` → корень, `reblog_parent_id` → прямой родитель). Отдельная таблица `reblogs` из предварительной модели ТЗ не нужна (отклонение задокументировано). Удаление/скрытие корня: реблоги показывают заглушку «пост удалён» (цепочка сохраняется); скрытые — не отображаются в лентах. Счётчики (likes/reblogs/comments) — денормализованы в `posts` и обновляются в тех же транзакциях, что и события.

### ADR-020. Структура проекта — модульный монолит

```
src/
  server.js            # bootstrap: конфиг, middleware, роуты, тикер
  config.js            # env-конфигурация
  db/                  # подключение, миграции, helper-транзакции
  modules/
    auth/              # регистрация, логин, сессии, CSRF
    blogs/             # блоги, настройки темы, кастомизация
    posts/             # 7 типов, черновики, публикация
    media/             # storage-абстракция, валидация, обработка
    social/            # follows, likes, reblogs, comments
    asks/
    search/
    notifications/
    moderation/        # жалобы, блокировки, админка
    stats/
  scheduler/           # тикер отложенных публикаций
  views/               # liquidjs-шаблоны (layout, dashboard, blog, admin…)
  public/              # css, js (ES-модули), svg-иконки
  locales/             # ru.json, en.json
migrations/            # NNN_name.sql
data/                  # sqlite.db, uploads/ (вне Git)
docs/                  # исследование, api, деплой
tests/                 # node:test
```

## Схема БД (уточнение предварительной модели ТЗ, раздел 9)

Ключевые отличия от ТЗ-черновика: реблог — часть `posts` (ADR-019); добавлены денормализованные счётчики, `body_html`, timezone/locale пользователя, настройки системы.

```sql
users(id PK, email UNIQUE NOT NULL, password_hash NOT NULL,
      role TEXT DEFAULT 'user',           -- user | moderator | admin
      status TEXT DEFAULT 'active',       -- active | blocked | deleted
      locale TEXT DEFAULT 'ru', timezone TEXT DEFAULT 'UTC',
      created_at, updated_at)

blogs(id PK, user_id UNIQUE NOT NULL REFERENCES users,  -- один блог на аккаунт
      slug UNIQUE NOT NULL, title, description,
      avatar_media_id REFERENCES media,
      theme JSON NOT NULL DEFAULT '{}',   -- фон, цвета, опции
      custom_css TEXT,                    -- санитизируется, только страница блога
      ask_enabled INT DEFAULT 1, ask_anonymous INT DEFAULT 0,
      created_at, updated_at)

posts(id PK, blog_id NOT NULL REFERENCES blogs,
      type TEXT NOT NULL,                 -- text|photo|quote|link|audio|video|gif
      title, body, body_html,             -- markdown + кеш санитизированного HTML
      source_url, source_author,          -- цитата/ссылка
      status TEXT NOT NULL,               -- draft|queued|scheduled|published|hidden|deleted
      nsfw INT DEFAULT 0,
      reblog_root_id REFERENCES posts, reblog_parent_id REFERENCES posts,
      published_at, scheduled_at, queue_position,
      like_count INT DEFAULT 0, reblog_count INT DEFAULT 0, comment_count INT DEFAULT 0,
      view_count INT DEFAULT 0,
      created_at, updated_at)

media(id PK, owner_blog_id REFERENCES blogs, kind TEXT,   -- image|gif|video|audio|cover|avatar
      storage_key UNIQUE NOT NULL, mime_type NOT NULL, size NOT NULL,
      width, height, duration_ms, metadata JSON, created_at)

post_media(post_id, media_id, position, PRIMARY KEY(post_id, media_id))
tags(id PK, name UNIQUE COLLATE NOCASE)
post_tags(post_id, tag_id, PRIMARY KEY(post_id, tag_id))

follows(user_id, blog_id, created_at, PRIMARY KEY(user_id, blog_id))
likes(user_id, post_id, created_at, PRIMARY KEY(user_id, post_id))

comments(id PK, post_id NOT NULL, user_id NOT NULL, body NOT NULL,
         status TEXT DEFAULT 'visible',   -- visible|hidden|deleted
         created_at, updated_at)

asks(id PK, blog_id NOT NULL, from_user_id REFERENCES users,  -- NULL = аноним
     is_anonymous INT DEFAULT 0, question TEXT NOT NULL,
     status TEXT DEFAULT 'new',         -- new|answered|ignored|deleted
     answer_post_id REFERENCES posts, created_at)

notifications(id PK, user_id NOT NULL, type TEXT NOT NULL, -- follow|like|reblog|comment|ask|moderation
              actor_blog_id, post_id, ask_id,
              is_read INT DEFAULT 0, created_at,
              UNIQUE(type, actor_blog_id, post_id, user_id))  -- антидубликат

reports(id PK, reporter_user_id NOT NULL, target_type TEXT NOT NULL,  -- post|comment|blog
        target_id NOT NULL, reason TEXT, details TEXT,
        status TEXT DEFAULT 'open',       -- open|resolved|rejected
        resolution TEXT, resolved_by REFERENCES users, resolved_at, created_at)

blocks(blocker_user_id, blocked_user_id, created_at, PRIMARY KEY(blocker_user_id, blocked_user_id))
moderation_actions(id PK, moderator_user_id NOT NULL, action TEXT NOT NULL,
                   target_type, target_id, reason, created_at)

post_views_daily(post_id, day TEXT, count INT, PRIMARY KEY(post_id, day))
sessions(id TEXT PK, user_id NOT NULL, expires_at NOT NULL, created_at, last_seen_at)
settings(key TEXT PK, value JSON NOT NULL)   -- лимиты загрузок, rate limits, регистрация on/off
migrations(version TEXT PK, applied_at)
```

Индексы: posts(status, published_at DESC), posts(blog_id, published_at DESC), posts(type), post_tags(tag_id), follows(blog_id), likes(post_id), comments(post_id, status, created_at), notifications(user_id, is_read), sessions(expires_at). Внешние ключи — ON; транзакции на всех мутациях со счётчиками. Никогда не доверять клиенту user_id/роль/владельца — из сессии.

### ADR-021. NSFW — скрытие на сервере, согласие через cookie
Тело 18+-поста **не рендерится вообще**, пока посетитель не дал согласия (кнопка «Показать» ставит cookie `tumbler.nsfw=1` на 90 дней и перезагружает страницу). CSS-подходы (blur/занавес поверх контента) отвергнуты: текст остаётся в HTML и доступен через «просмотр исходника». Владелец блога видит свои NSFW-посты всегда.

### ADR-022. Экранирование в шаблонах — автоэкранирование liquidjs
Все выводы `{{ ... }}` экранируются движком (`outputEscape: 'escape'`). Доверенный HTML помечается `| raw` — только `post.body_html` (markdown через sanitize-html) и `comments.body` (renderPlain: теги вырезаны, переносы строк заменены на `<br>`). Ручные `| escape` в шаблонах не нужны и приводят к двойному экранированию. Причина решения: до него названия и описания блогов, цитаты и вопросы выводились сырыми — хранимая XSS (проверено на копии данных). Новое поле, выводимое в шаблон, по умолчанию безопасно; `| raw` — только для значений, прошедших собственную санитизацию.

## Отложенные решения

- Перекодирование видео/аудио (ffmpeg) — если лимиты не решат проблему больших файлов.
- Бесконечная лента — нет, классическая пагинация + кнопка «Загрузить ещё» (без изменения порядка).
- Капча для ask/регистрации — только если спам станет реальным; сначала rate limiting.
- Федерация (ActivityPub) — вне ТЗ, архитектурой не блокируется только в смысле изоляции модулей.
