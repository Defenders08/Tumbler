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
    });
    assert.equal(save.status, 303);

    const blog = t.ctx.db.prepare('SELECT * FROM blogs WHERE slug = ?').get('marta');
    assert.equal(blog.title, 'Новое название');
    assert.equal(blog.description, 'Моё описание');

    // Гость видит обновлённое название
    const guest = await createAgent(t.base);
    const page = await guest.get('/marta');
    assert.match(page.html, /Новое название/);
  } finally {
    await t.close();
  }
});

test('тематическое оформление убрано: блоги на канве дашборда', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'marta' });
    const settings = await agent.get('/settings/blog');
    assert.doesNotMatch(settings.html, /Цвет фона|bg_color/, 'контролы темы удалены из настроек');

    const guest = await createAgent(t.base);
    const page = await guest.get('/marta');
    assert.doesNotMatch(page.html, /blog-surface/, 'страница блога на канве дашборда');
    assert.match(page.html, /blog-identity/, 'идентичность блога — карточка');
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
