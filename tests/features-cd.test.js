// Тесты этапов C и D: WYSIWYG-составляющая (turndown-конвертация серверного пути не меняется —
// здесь проверяем связки), графики статистики и кастомизация (акцент + кастомный фон).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent, makePng, makeAnimatedGif } from './helpers.js';
import { viewsSeries, svgChart } from '../src/modules/api/stats.js';
import { dominantHue, hexToHue, effectiveHue, tintShift } from '../src/lib/colors.js';

test('графики: серии по дням и SVG-полилиния', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    await a.agent.postForm('/posts', { action: 'publish', type: 'text', body: 'график', _csrf: a.agent.csrf });
    // Гость ходит на пермалинк дважды (один визит в сутки)
    const guest = await createAgent(t.base);
    await guest.get('/anna/1');
    await guest.get('/anna/1');

    const series = viewsSeries(t.ctx.db, t.ctx.db.prepare('SELECT id FROM blogs WHERE slug = ?').get('anna').id, 30);
    assert.equal(series.length, 30);
    const today = series[series.length - 1];
    assert.equal(today.n, 1, 'сегодняшний визит в серии');
    const chart = svgChart(series);
    assert.match(chart.points, /,/);
    assert.equal(chart.max, 1);
  } finally {
    await t.close();
  }
});

test('кастомизация: акцентный цвет применяется на странице блога', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const save = await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, title: 'Анна', description: '', accent_color: '#ff8800',
    });
    assert.equal(save.status, 303);
    const theme = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(theme.accentColor, '#ff8800');

    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    assert.match(page.html, /--blog-accent: #ff8800/);
    // Старых контролов темы нет
    const settings = await a.agent.get('/settings/blog');
    assert.doesNotMatch(settings.html, /Цвет фона/);
  } finally {
    await t.close();
  }
});

test('кастомный фон: загрузка сохраняет media, применяется на всю страницу блога, удаление работает', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const png = await makePng();
    const up = await a.agent.postMultipart('/settings/blog/background', { _csrf: a.agent.csrf }, [
      { field: 'background', data: png, mime: 'image/png', name: 'background.png' },
    ]);
    assert.equal(up.status, 303);
    const theme = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.match(theme.backgroundKey, /^[0-9a-f]{32}$/);
    assert.equal(theme.bannerKey, undefined, 'старое поле шапки не пишется');
    assert.ok(Number.isInteger(theme.backgroundHue), 'оттенок фона сохранён в теме');
    const media = t.ctx.db.prepare('SELECT * FROM media WHERE storage_key = ?').get(theme.backgroundKey);
    assert.ok(media, 'фон сохранён в media');
    assert.equal(media.kind, 'cover');
    assert.equal(media.mime_type, 'image/png');
    const mediaRes = await fetch(`${t.base}/media/${theme.backgroundKey}`);
    assert.equal(mediaRes.status, 200, 'фон отдаётся через /media');

    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    assert.match(page.html, /has-blog-bg/, 'страница блога получает класс фона');
    assert.ok(page.html.includes(`--blog-bg: url(/media/${theme.backgroundKey})`), 'фон подключён как CSS-переменная');
    assert.match(page.html, /has-blog-tint/, 'страница получает перекраску');
    assert.match(page.html, /--tint-shift: -?\d+/, 'сдвиг палитры в разметке');
    assert.doesNotMatch(page.html, /blog-banner/, 'шапка-баннер больше не рендерится');

    // Сохранение только акцентного цвета не сбрасывает фон
    const accent = await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, section: 'appearance', accent_color: '#ff8800',
    });
    assert.equal(accent.status, 303);
    const themeAfterAccent = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(themeAfterAccent.accentColor, '#ff8800');
    assert.equal(themeAfterAccent.backgroundKey, theme.backgroundKey, 'фон сохраняется при смене акцента');
    assert.equal(themeAfterAccent.backgroundHue, theme.backgroundHue, 'оттенок сохраняется при смене акцента');

    // Удаление фона
    const del = await a.agent.postForm('/settings/blog/background/remove', { _csrf: a.agent.csrf });
    assert.equal(del.status, 303);
    const theme2 = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(theme2.backgroundKey, null);
    assert.equal(t.ctx.db.prepare('SELECT id FROM media WHERE storage_key = ?').get(theme.backgroundKey), undefined);
    const page2 = await guest.get('/anna');
    assert.doesNotMatch(page2.html, /has-blog-bg/);
  } finally {
    await t.close();
  }
});

test('перекраска: оттенок берётся из фоновой картинки и сдвигает палитру', async () => {
  const hue = await dominantHue(await makePng());
  assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, 'оттенок — целое 0..359');
  // makePng — #dd4b39, красно-оранжевый
  assert.ok(hue < 30 || hue > 330, `у красной картинки ожидали тёплый оттенок, получили ${hue}`);

  assert.equal(tintShift(213), 0, 'базовый оттенок не сдвигает палитру');
  assert.equal(tintShift(hue), ((hue - 213 + 540) % 360) - 180);
  assert.equal(hexToHue('#22cc44'), 132);
  assert.equal(hexToHue('#808080'), null, 'серый цвет не даёт оттенка');
  assert.equal(tintShift(null), null);

  assert.equal(effectiveHue({ tintMode: 'off', backgroundHue: 40 }), null);
  assert.equal(effectiveHue({ tintMode: 'auto', backgroundHue: 40 }), 40);
  assert.equal(effectiveHue({ tintMode: 'auto', backgroundHue: null }), null);
  assert.equal(effectiveHue({ tintMode: 'custom', tintColor: '#22cc44', backgroundHue: 40 }), 132);

  // Почти серая картинка не даёт оттенка — интерфейс остаётся синим
  const { default: sharp } = await import('sharp');
  const gray = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } }).png().toBuffer();
  assert.equal(await dominantHue(gray), null);
});

test('экранирование: HTML из названия и описания блога не исполняется', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const save = await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf,
      section: 'profile',
      title: '<img src=x onerror=alert(1)>Анна',
      description: '<b>злой</b>',
    });
    assert.equal(save.status, 303);

    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    assert.doesNotMatch(page.html, /<img src=x onerror/, 'тег из названия не рендерится');
    assert.match(page.html, /&lt;img src=x onerror=alert\(1\)&gt;Анна/, 'название экранировано');
    assert.doesNotMatch(page.html, /<b>злой<\/b>/, 'тег из описания не рендерится');
    assert.match(page.html, /&lt;b&gt;злой&lt;\/b&gt;/, 'описание экранировано');
  } finally {
    await t.close();
  }
});

test('экранирование: комментарий не внедряет HTML, переносы сохраняются', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    await a.agent.postForm('/posts', { _csrf: a.agent.csrf, action: 'publish', type: 'text', body: 'пост' });
    const post = t.ctx.db.prepare("SELECT id FROM posts WHERE blog_id = (SELECT id FROM blogs WHERE slug = 'anna') ORDER BY id DESC").get();
    const comment = await a.agent.postForm(`/posts/${post.id}/comments`, {
      _csrf: a.agent.csrf,
      body: '<b>жирный</b>\nвторая строка <script>alert(1)</script>',
    });
    assert.equal(comment.status, 303);

    const guest = await createAgent(t.base);
    const page = await guest.get(`/anna/${post.id}`);
    assert.doesNotMatch(page.html, /<b>жирный<\/b>/, 'сырой тег не попал в разметку');
    assert.doesNotMatch(page.html, /<script>alert/, 'скрипт вырезан');
    assert.doesNotMatch(page.html, /alert\(1\)/, 'содержимое скрипта удалено');
    assert.match(page.html, /<br>\s*вторая строка/, 'перенос строки отрисован');
  } finally {
    await t.close();
  }
});

test('соцсети блога: сохранение, значок в шапке и санитизация ссылок', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const save = await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf,
      section: 'profile',
      title: 'Анна',
      description: '',
      social_network: ['telegram', 'youtube', 'website', 'website'],
      social_label: ['ashwtfyourmom', '', 'shotacore', '<b>x</b>'],
      social_url: ['https://t.me/ash', 'youtube.com/@shotacore', 'javascript:alert(1)', 'https://example.com'],
    });
    assert.equal(save.status, 303);
    const theme = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(theme.socials.length, 3, 'javascript: отброшен, остальные три сохранены');
    assert.deepEqual(theme.socials[0], { network: 'telegram', label: 'ashwtfyourmom', url: 'https://t.me/ash' });
    assert.equal(theme.socials[1].url, 'https://youtube.com/@shotacore', 'схема https добавлена');
    assert.equal(theme.socials[1].label, 'YouTube', 'пустая подпись — имя сети');

    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    assert.match(page.html, /class="blog-socials"/);
    assert.match(page.html, /data-net="telegram"/);
    assert.ok(page.html.includes('ashwtfyourmom'), 'подпись в шапке');
    assert.doesNotMatch(page.html, /javascript:alert/, 'опасная ссылка не попала в разметку');
    assert.match(page.html, /&lt;b&gt;x&lt;\/b&gt;/, 'подпись экранирована');
    assert.doesNotMatch(page.html, /<b>x<\/b>/, 'сырой html в подписи не рендерится');

    // Смена оформления не затирает соцсети
    await a.agent.postForm('/settings/blog', { _csrf: a.agent.csrf, section: 'appearance', accent_color: '#ff8800' });
    const themeAfter = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(themeAfter.socials.length, 3, 'соцсети переживают смену оформления');

    // Пустая строка очищает список
    await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, section: 'profile', title: 'Анна', description: '',
      social_network: ['telegram'], social_label: [''], social_url: [''],
    });
    const cleared = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(cleared.socials.length, 0);
    assert.doesNotMatch((await guest.get('/anna')).html, /class="blog-socials"/);
  } finally {
    await t.close();
  }
});

test('оттенок интерфейса: по картинке, свой цвет или отключение', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const guest = await createAgent(t.base);

    // По умолчанию — по картинке; фона нет, значит палитра стандартная
    const settings = await a.agent.get('/settings/blog');
    assert.match(settings.html, /Оттенок интерфейса/);
    assert.match(settings.html, /name="tint_mode" value="auto" checked/);
    assert.doesNotMatch((await guest.get('/anna')).html, /has-blog-tint/);

    // Свой цвет — сдвиг от выбранного цвета, даже без картинки
    let save = await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, section: 'appearance', accent_color: '#2f9dd6',
      tint_mode: 'custom', tint_color: '#22cc44',
    });
    assert.equal(save.status, 303);
    let theme = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(theme.tintMode, 'custom');
    assert.equal(theme.tintColor, '#22cc44');
    let page = await guest.get('/anna');
    assert.match(page.html, /has-blog-tint/);
    assert.ok(page.html.includes(`--tint-shift: ${tintShift(132)}`), 'сдвиг для выбранного цвета');

    // Отключение — возврат к стандартной синей палитре
    save = await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, section: 'appearance', accent_color: '#2f9dd6', tint_mode: 'off',
    });
    assert.equal(save.status, 303);
    theme = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(theme.tintMode, 'off');
    page = await guest.get('/anna');
    assert.doesNotMatch(page.html, /has-blog-tint/);
    assert.doesNotMatch(page.html, /--tint-shift/);
  } finally {
    await t.close();
  }
});

test('WYSIWYG: композер отдаёт скрытый input body, конвертация — на клиенте (сервер принимает Markdown)', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const dash = await a.agent.get('/dashboard');
    assert.match(dash.html, /js-wysiwyg/);
    assert.match(dash.html, /vendor\/turndown\.js/);
    // Сервер по-прежнему принимает markdown в body — обратная совместимость с API и тестами
    const res = await a.agent.postForm('/posts', {
      action: 'publish', type: 'text', body: 'Жирный **текст** из WYSIWYG', _csrf: a.agent.csrf,
    });
    assert.equal(res.status, 303);
    const blog = await a.agent.get('/anna');
    assert.match(blog.html, /<strong>текст<\/strong>/);
  } finally {
    await t.close();
  }
});
