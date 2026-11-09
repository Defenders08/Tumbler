// Тесты этапов C и D: WYSIWYG-составляющая (turndown-конвертация серверного пути не меняется —
// здесь проверяем связки), графики статистики и новая кастомизация (акцент + баннер).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent, makePng, makeAnimatedGif } from './helpers.js';
import { viewsSeries, svgChart } from '../src/modules/api/stats.js';

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

test('баннер: загрузка сохраняет media, показывается в карточке блога, удаление работает', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const png = await makePng();
    const up = await a.agent.postMultipart('/settings/blog/banner', { _csrf: a.agent.csrf }, [
      { field: 'banner', data: png, mime: 'image/png', name: 'banner.png' },
    ]);
    assert.equal(up.status, 303);
    const theme = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.match(theme.bannerKey, /^[0-9a-f]{32}$/);

    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    assert.match(page.html, new RegExp(`/media/${theme.bannerKey}`));

    // Удаление баннера
    const del = await a.agent.postForm('/settings/blog/banner/remove', { _csrf: a.agent.csrf });
    assert.equal(del.status, 303);
    const theme2 = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('anna').theme);
    assert.equal(theme2.bannerKey, undefined);
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
