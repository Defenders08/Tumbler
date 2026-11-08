# Обзор open-source: платформы и библиотеки для Tumbler

**Статус:** исследование Этапа 0. Состояние проверено на ноябрь 2026 (npm registry, OSV, GitHub).
**Контекст:** модульный монолит Node.js + SQLite, SSR, локальное файловое хранилище, 100–1000 пользователей, без обязательных платных сервисов.

## Часть 1. Существующие платформы (референсы, не код)

Главный вывод: почти вся индустрия соцсетей ушла в PostgreSQL + Redis. Живых соцсетей «из коробки» на SQLite очень мало (GoToSocial, WriteFreely). «Блоговая соцсеть Tumblr-типа на Node + SQLite» — свободная ниша; проект собирается из концепций.

| Платформа | Лицензия | Стек | SQLite | Активность | Что берём концептуально |
|---|---|---|---|---|---|
| Ghost | MIT | Node.js/TS | Нет (production = MySQL 8) | Очень высокая (v6.75, 11.2026) | Редактор, темы, журнал действий админки |
| WriteFreely | AGPL-3.0 | Go | Встроена | Активен (v0.17.2, 08.2026) | Минимализм, мультипользовательские инстансы |
| Plume | AGPL-3.0 | Rust | Вторичная | Фактически остановлен | Только идеи, не база |
| Mataroa | AGPL-3.0 | Python/Django | Нет (PG-only) | Живой | Радикальный минимализм, экспорт данных как первичная функция |
| Mastodon | AGPL-3.0 | Rails+React | Нет | Очень высокая (v4.7.5) | Модель модерации: репорты, mute/block, CW, очереди жалоб |
| GoToSocial | AGPL-3.0 | Go | **Из коробки** | Активен (v0.22.3, 10.2026) | **Самый релевантный**: гранулярные permissions на взаимодействия (кто может отвечать/реблогать/лайкать), простая модерация малых инстансов |
| Misskey / Sharkey | AGPL-3.0 | Node.js/TS | Нет (PG+Redis) | Очень высокая | Ленты, «тумблроидные» механики, Node-референс соцсети |
| Pleroma/Akkoma | AGPL-3.0 | Elixir | Нет (PG-only) | Akkoma живой | Разделение API и frontend |
| NodeBB | GPL-3.0 | Node.js | Нет (Mongo/PG/Redis) | Активен (v4.16.7) | Паттерн абстракции хранилища, виджеты (это форум) |
| Wafrn | не подтверждена | NestJS+Next+PG | Нет | Живой | Самый «тумблровский» проект: реблоги, реакции — проверить лицензию перед любым заимствованием |

**Лицензионное правило:** все социальные референсы — AGPL/GPL. Их **код не копируется** ни в каком виде; заимствуются только концепции (модель модерации, разрешения взаимодействий). NPM-зависимости проекта — только MIT/Apache/ISC/BSD.

Реконструкции интерфейса старого Tumblr:
- **Dashboard Unfucker** (GPL-3.0, архивирован) и **XKit Rewritten** (GPL-3.0, активен) — списки «классических» требований пользователей к дашборду; полезны как чек-лист ностальгического UX. Код не копируем.
- Точной CSS-реконструкции дашборда 2012 на GitHub **нет** (проверенный пробел) — но она и не нужна: оригинальный CSS 2012 добыт напрямую из Wayback (см. tumblr-2012.md).
- Старые темы Tumblr на GitHub (sanographix/tumblr, davesantos/tumblr-boilerplate, mwunsch/thimble 2012 года) — референсы оформления публичных блогов.

## Часть 2. NPM-библиотеки (состояние на 11.2026)

Все рекомендованные версии чисты по OSV на дату проверки.

| Назначение | Рекомендация | Лицензия | Состояние | Вердикт |
|---|---|---|---|---|
| HTTP | express@5.3.0 | MIT | Express 5 — дефолтный `latest` с 03.2025; v4 патчатся | **Брать**. Fastify избыточен (плагины/схемы не нужны) |
| SQLite | better-sqlite3@13.0.3 | MIT | С v13 на N-API: prebuilt-бинари Node 22/24/26, macOS ARM, Linux | **Брать** (обоснование ниже) |
| Миграции | самописные SQL + таблица миграций | — | umzug/db-migrate тяжеловаты | **Самописные** (пара сотен строк, полный контроль) |
| Пароли | argon2@0.45.2 (Argon2id) | MIT | Очень активен | **Брать** (OWASP-рекомендация, memory-hard) |
| Сессии | cookie-session@2.1.1 или свой store на better-sqlite3 | MIT | connect-sqlite3 полужив и тянет чужой нативный `sqlite3`; better-sqlite3-session-store — заброшен + GPL | **Свой SQLite-store (~50 строк)** — ТЗ требует таблицу sessions |
| CSRF | csrf-csrf@4.1.0 | ISC | Активен, OWASP signed double-submit | **Брать**. csurf — архивирован (2020), не брать |
| Rate limit | express-rate-limit@8.7.3 | MIT | Очень активен, memory-store достаточен для 1 процесса | **Брать** |
| Загрузка файлов | multer@2.5.0 | MIT | В 2025 серия DoS-CVE — всё закрыто в 2.x; 2.2→2.5 за 2026 | **Брать ≥2.5**, следить за advisories |
| Проверка MIME | file-type@22.3.0 | MIT | ESM-only, Node ≥22; mmmagic — заброшен (2019) | **Брать** (динамический import из CJS) + sharp-перекрёстная проверка |
| Изображения/GIF | sharp@0.35.5 | Apache-2.0 | Активен; анимированные GIF/WebP читаются и пишутся; prebuilt-бинари | **Брать**, де-факто стандарт |
| Разметка | markdown-it@15.0.3 + sanitize-html@2.18.1 | MIT | Активны | **Брать связку**: хранить markdown, санитизировать при рендере. DOMPurify на сервере тянет jsdom — избыточно |
| Шаблоны | liquidjs@10.30.1 | MIT | Активен (релизы каждые 2–4 недели); nunjucks — релизов нет с 04.2023, Mozilla в режиме присмотра | **liquidjs** (наследование `{% layout %}` из коробки). ejs ожил, но без наследования |
| Валидация | zod@4.6.7 | MIT | Активен, zero-deps | **Брать** для серверной валидации форм/API |
| Поиск | FTS5 + unicode61 (встроен в SQLite) | — | Включён в better-sqlite3 по умолчанию (проверено runtime-тестом) | **Брать**; porter бесполезен для русского (см. ниже) |
| Планировщик | свой тикер поверх SQLite | — | Любой cron-пакет хранит расписание в памяти — теряется при рестарте | **Свой** (таблица + setInterval-тикер). node-cron — только для периодики (бэкапы, чистка) |
| i18n | свой JSON-словарь ru/en | — | i18next избыточен для 2 языков; русская плюрализация ~20 строк | **Свой словарь**; i18next — при росте числа языков |
| Время | Date + UTC + Intl.DateTimeFormat | — | Хранение epoch/UTC; отображение через встроенный Intl | **Встроенного достаточно**; luxon — только если UI планирования потребует парсинга дат |

## Ключевые обоснования

**better-sqlite3 vs node:sqlite.** `node:sqlite` — статус 1.2 (Release Candidate) в Node 24.15+/25.7+, официального «Stable» ещё нет; API минималистичен, нет транзакций/pragma-хелперов. better-sqlite3: синхронный API идеален для монолита, v13 на N-API ставится без компиляции, FTS5 включён (проверено живым тестом: `sqlite_compileoption_used('ENABLE_FTS5') = 1`). Для продакшена на VPS — better-sqlite3.

**Русский поиск в FTS5.** Встроенный porter стеммит только английский — не использовать. unicode61 корректно токенизирует кириллицу. Словоформы («пост/поста/посту») — главный недуг: обход через префиксные запросы `пост*` (обрезка до 5–6 символов при разборе ввода) + LIKE-фолбэк для запросов <3 символов. Русского стеммера без пересборки SQLite не получить (API регистрации токенайзеров не экспортирован) — осознанное ограничение.

**Сессии.** ТЗ требует таблицу `sessions` (жёсткий logout, мгновенная смена ролей, модерация) — значит серверные сессии в SQLite: свой store на better-sqlite3 (~50 строк: select/delete по expires_at), id — 32 случайных байта, cookie httpOnly + sameSite=strict + secure в production. cookie-session — запасной вариант, не основной.

**Multer.** История 2025 года (CVE-2025-48997 — malicious filename; CVE-2025-7338 — краш malformed-запросом; и др.) закрыта в 2.0.x–2.1.x; проект оживлён. Обязательные меры независимо от версии: `limits.fileSize`/`files`, diskStorage в каталог вне веб-корня, проверка содержимого file-type + sharp.

**Разметка постов.** Хранить markdown-источник; рендерить при выводе: `markdown-it({ html: false })` → sanitize-html с allowlist (a, b, i, em, strong, code, pre, blockquote, img; протоколы только http/https) + кеш отрендеренного HTML в строке поста.

## Итоговый рекомендуемый стек

```
Node.js 24 LTS · express@5 · better-sqlite3@13 · самописные SQL-миграции
argon2 (Argon2id) · сессии в SQLite (свой store) · csrf-csrf · express-rate-limit
multer@2.5 · file-type + sharp · markdown-it + sanitize-html · liquidjs · zod
FTS5 unicode61 (+prefix, LIKE-фолбэк) · свой SQLite-планировщик · JSON-словарь i18n
vanilla ES-modules JS на клиенте (без бандлера) · plain CSS (без фреймворков)
```

Заброшенные/проблемные, которых избегаем: csurf (архив), mmmagic (2019), nunjucks (дремлет с 2023), connect-sqlite3 (чужой нативный драйвер), better-sqlite3-session-store (GPL + заброшен), busboy как прямая зависимость, Redis/PostgreSQL (не нужны на этом масштабе), SPA-фреймворки и бандлеры (противоречат «гибридному интерфейсу» ТЗ).

## Источники

- npm registry и страницы пакетов: registry.npmjs.org; npmjs.com/package/{express,fastify,better-sqlite3,argon2,cookie-session,csrf-csrf,express-rate-limit,multer,file-type,sharp,markdown-it,sanitize-html,liquidjs,ejs,zod,node-cron,i18next,luxon}
- OSV API: api.osv.dev; multer advisories: GHSA-g5hg-p3ph-g8qg (CVE-2025-48997), GHSA-44fp-w29j-9vj5, CVE-2025-7338, CVE-2025-47935
- better-sqlite3 releases: github.com/WiseLibs/better-sqlite3/releases
- node:sqlite статус: nodejs.org/api/sqlite.html, github.com/nodejs/node/issues/57445
- FTS5 и токенайзеры: sqlite.org/fts5.html
- sharp (анимированные GIF): sharp.pixelplumbing.com/api-output#gif
- nunjucks активность: github.com/mozilla/nunjucks
- Платформы: github.com/TryGhost/Ghost (+ docs.ghost.org/faq/supported-databases), github.com/writefreely/writefreely, codeberg.org/superseriousbusiness/gotosocial, github.com/mastodon/mastodon, github.com/misskey-dev/misskey, github.com/NodeBB/NodeBB (+ docs.nodebb.org/configuring/databases), github.com/Wafrn/wafrn
- Реконструкции UI: github.com/enchanted-sword/dashboard-unfucker, github.com/AprilSylph/XKit-Rewritten, github.com/new-xkit/extension, github.com/mwunsch/thimble, webdesignmuseum.org/timeline/tumblr-2012
