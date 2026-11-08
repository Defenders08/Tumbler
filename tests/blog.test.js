// Тесты блогов: настройки профиля и темы, аватар, публичная страница, пермалинк.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent, makePng } from './helpers.js';

async function createPostViaForm(t, agent, fields) {
  return agent.postForm('/posts', { action: 'publish', ...fields, _csrf: agent.csrf });
}

test('гость видит публичный блог: шапка, описание, посты', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, {
      email: 'a@example.com',
      password: 'parol-1234',
      slug: 'marta',
      title: 'Блог Марта',
    });
    await createPostViaForm(t, agent, { type: 'text', title: 'Публичный', body: 'Всем привет!' });

    const guest = await createAgent(t.base);
    const { res, html } = await guest.get('/marta');
    assert.equal(res.status, 200);
    assert.match(html, /Блог Марта/);
    assert.match(html, /Публичный/);
    assert.match(html, /Всем привет/);
    assert.doesNotMatch(html, /js-composer-form/, 'композер гостю не показывается');
  } finally {
    await t.close();
  }
});

test('настройки блога: профиль и тема сохраняются', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'marta' });

    const settings = await agent.get('/settings/blog');
    assert.equal(settings.res.status, 200);
    assert.match(settings.html, /Настройки блога/);

    const save = await agent.postForm('/settings/blog', {
      _csrf: agent.csrf,
      title: 'Новое название',
      description: 'Моё описание',
      bg_color: '#101010',
      accent_color: '#ff0000',
      text_color: '#eeeeee',
      font: 'georgia',
    });
    assert.equal(save.status, 303);

    const blog = t.ctx.db.prepare('SELECT * FROM blogs WHERE slug = ?').get('marta');
    assert.equal(blog.title, 'Новое название');
    assert.equal(blog.description, 'Моё описание');
    const theme = JSON.parse(blog.theme);
    assert.equal(theme.bgColor, '#101010');
    assert.equal(theme.font, 'georgia');

    // Гость видит обновлённое название и инлайновую тему
    const guest = await createAgent(t.base);
    const page = await guest.get('/marta');
    assert.match(page.html, /Новое название/);
    assert.match(page.html, /#101010/);
  } finally {
    await t.close();
  }
});

test('некорректные цвета темы заменяются стандартными, а не ломают страницу', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'marta' });
    await agent.postForm('/settings/blog', {
      _csrf: agent.csrf,
      title: 'T',
      description: '',
      bg_color: 'javascript:alert(1)',
      accent_color: '#zzzzzz',
      text_color: '#444444',
      font: 'comic-sans',
    });
    const theme = JSON.parse(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('marta').theme);
    assert.ok(/^#[0-9a-f]{6}$/.test(theme.bgColor));
    assert.ok(/^#[0-9a-f]{6}$/.test(theme.accentColor));
    assert.equal(theme.font, 'helvetica');
  } finally {
    await t.close();
  }
});

test('предпросмотр темы (tp) работает только для владельца', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'marta' });
    const tp = encodeURIComponent(JSON.stringify({ bgColor: '#123456', accentColor: '#abcdef', textColor: '#ffffff', font: 'courier' }));

    const ownerPage = await agent.get(`/marta?tp=${tp}`);
    assert.match(ownerPage.html, /#123456/);

    const guest = await createAgent(t.base);
    const guestPage = await guest.get(`/marta?tp=${tp}`);
    assert.doesNotMatch(guestPage.html, /#123456/, 'гостю предпросмотр не показывается');
  } finally {
    await t.close();
  }
});

test('сброс темы возвращает стандартную', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'marta' });
    await agent.postForm('/settings/blog', {
      _csrf: agent.csrf,
      title: 'T', description: '', bg_color: '#101010', accent_color: '#ff0000', text_color: '#eeeeee', font: 'georgia',
    });
    const reset = await agent.postForm('/settings/blog/reset-theme', { _csrf: agent.csrf });
    assert.equal(reset.status, 303);
    // Сброс — пустой JSON в базе; parseTheme подставит стандартные значения при рендере.
    assert.equal(t.ctx.db.prepare('SELECT theme FROM blogs WHERE slug = ?').get('marta').theme, '{}');
    const guest = await createAgent(t.base);
    const page = await guest.get('/marta');
    assert.match(page.html, /#f2f4f7/);
  } finally {
    await t.close();
  }
});

test('загрузка аватара: создаётся media, привязывается к блогу, замена удаляет старый файл', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'marta' });
    const png = await makePng();

    const up1 = await agent.postMultipart('/settings/blog/avatar', { _csrf: agent.csrf }, [
      { field: 'avatar', data: png, mime: 'image/png', name: 'avatar.png' },
    ]);
    assert.equal(up1.status, 303);

    const blog1 = t.ctx.db.prepare('SELECT * FROM blogs WHERE slug = ?').get('marta');
    assert.ok(blog1.avatar_media_id);
    const mediaCount1 = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
    assert.equal(mediaCount1, 1);

    const page = await agent.get('/marta');
    assert.match(page.html, new RegExp(`/media/[0-9a-f]{32}`));

    // Вторая загрузка: старый аватар удаляется из БД
    const up2 = await agent.postMultipart('/settings/blog/avatar', { _csrf: agent.csrf }, [
      { field: 'avatar', data: png, mime: 'image/png', name: 'avatar2.png' },
    ]);
    assert.equal(up2.status, 303);
    const mediaCount2 = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
    assert.equal(mediaCount2, 1);
  } finally {
    await t.close();
  }
});

test('аватар: файл .exe под видом изображения отклоняется', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'marta' });
    const { makeExe } = await import('./helpers.js');
    const up = await agent.postMultipart('/settings/blog/avatar', { _csrf: agent.csrf }, [
      { field: 'avatar', data: makeExe(), mime: 'image/png', name: 'avatar.png' },
    ]);
    assert.equal(up.status, 422);
    const mediaCount = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
    assert.equal(mediaCount, 0);
  } finally {
    await t.close();
  }
});

test('несуществующий блог: 404', async () => {
  const t = await createTestApp();
  try {
    const res = await fetch(`${t.base}/no-such-blog-here`);
    assert.equal(res.status, 404);
  } finally {
    await t.close();
  }
});
