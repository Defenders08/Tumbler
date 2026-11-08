// Тесты Этапа 9: API v1, просмотры, статистика блога.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent } from './helpers.js';

async function seeded(t) {
  const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
  const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Борис' });
  return { a, b };
}

async function postAs(agent, fields) {
  const res = await agent.postForm('/posts', { action: 'publish', type: 'text', _csrf: agent.csrf, ...fields });
  assert.equal(res.status, 303);
  return Number(res.headers.get('location').match(/created=(\d+)/)?.[1]);
}

test('API: список публичных постов с пагинацией и фильтром типа', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    await postAs(a.agent, { body: 'текстовый пост' });
    await a.agent.postForm('/posts', { action: 'publish', type: 'quote', quote: 'цитата про поиск', _csrf: a.agent.csrf });

    const all = await (await fetch(`${t.base}/api/v1/posts?limit=1`)).json();
    assert.equal(all.data.length, 1);
    assert.equal(all.meta.total, 2);
    assert.equal(all.meta.pages, 2);
    assert.ok(all.data[0].blog.slug);

    const quotes = await (await fetch(`${t.base}/api/v1/posts?type=quote`)).json();
    assert.equal(quotes.meta.total, 1);
    assert.match(quotes.data[0].quoteText, /цитата/);

    // Черновики и удалённые не попадают
    await a.agent.postForm('/posts', { action: 'draft', type: 'text', body: 'черновик', _csrf: a.agent.csrf });
    const after = await (await fetch(`${t.base}/api/v1/posts`)).json();
    assert.equal(after.meta.total, 2);
  } finally {
    await t.close();
  }
});

test('API: блог, посты блога, 404 для неизвестных', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    await postAs(a.agent, { body: 'пост Анны' });

    const blog = await (await fetch(`${t.base}/api/v1/blogs/anna`)).json();
    assert.equal(blog.data.slug, 'anna');
    assert.equal(blog.data.posts, 1);
    assert.ok(typeof blog.data.followers === 'number');

    const posts = await (await fetch(`${t.base}/api/v1/blogs/anna/posts`)).json();
    assert.equal(posts.data.length, 1);
    assert.match(posts.data[0].bodyHtml, /пост Анны/);

    const missing = await fetch(`${t.base}/api/v1/blogs/nope`);
    assert.equal(missing.status, 404);
    const body = await missing.json();
    assert.equal(body.error.code, 'not_found');
  } finally {
    await t.close();
  }
});

test('API: поиск и теги', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    await postAs(a.agent, { body: 'про спорт и тренировки', tags: 'спорт' });

    const search = await (await fetch(`${t.base}/api/v1/search?q=${encodeURIComponent('спорт')}`)).json();
    assert.equal(search.data.posts.length, 1);
    assert.ok(search.data.tags.some((tg) => tg.name === 'спорт'));

    const tag = await (await fetch(`${t.base}/api/v1/tags/спорт`)).json();
    assert.equal(tag.data.tag, 'спорт');
    assert.equal(tag.data.posts.length, 1);
    assert.equal(tag.meta.total, 1);
  } finally {
    await t.close();
  }
});

test('API: приватные endpoints требуют сессию; с сессией отдают данные', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await seeded(t);

    const noAuth = await fetch(`${t.base}/api/v1/me`);
    assert.equal(noAuth.status, 401);
    assert.equal((await noAuth.json()).error.code, 'need_login');

    const me = await (await fetch(`${t.base}/api/v1/me`, { headers: { cookie: a.agent.cookieHeader() } })).json();
    assert.equal(me.data.email, 'a@example.com');
    assert.equal(me.data.blog.slug, 'anna');

    // Уведомления: Борис лайкнул пост Анны
    await postAs(a.agent, { body: 'пост' });
    await fetch(`${t.base}/api/posts/1/like`, { method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf } });
    const notifications = await (await fetch(`${t.base}/api/v1/notifications`, { headers: { cookie: a.agent.cookieHeader() } })).json();
    assert.equal(notifications.meta.unread, 1);
    assert.equal(notifications.data[0].type, 'like');
    assert.equal(notifications.data[0].actor.slug, 'boris');
  } finally {
    await t.close();
  }
});

test('просмотры: пермалинк считается один раз на посетителя в сутки; владелец не считается', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    const postId = await postAs(a.agent, { body: 'считаем просмотры' });

    const guest = await createAgent(t.base);
    await guest.get(`/anna/${postId}`);
    await guest.get(`/anna/${postId}`);
    const api = await (await fetch(`${t.base}/api/v1/posts/${postId}`)).json();
    assert.equal(api.data.views, 1, 'двойной визит — один просмотр');

    // Другой посетитель: первый визит выдаёт cookie, второй — считается
    const guest2 = await createAgent(t.base);
    await guest2.get(`/anna/${postId}`);
    await guest2.get(`/anna/${postId}`);
    const api2 = await (await fetch(`${t.base}/api/v1/posts/${postId}`)).json();
    assert.equal(api2.data.views, 2);

    // Просмотры отображаются в самой карточке поста на странице блога
    const guest3 = await createAgent(t.base);
    const blogPage = await guest3.get('/anna');
    assert.match(blogPage.html, /views-stat/);
    assert.match(blogPage.html, /i-eye/);

    // Владелец не добавляет просмотры
    await a.agent.get(`/anna/${postId}`);
    const api3 = await (await fetch(`${t.base}/api/v1/posts/${postId}`)).json();
    assert.equal(api3.data.views, 2);
  } finally {
    await t.close();
  }
});

test('статистика блога: страница владельца и публичный API-агрегат', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await seeded(t);
    const postId = await postAs(a.agent, { body: 'пост для статистики' });
    await fetch(`${t.base}/api/posts/${postId}/like`, { method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf } });
    await fetch(`${t.base}/api/blogs/anna/follow`, { method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf } });

    const apiStats = await (await fetch(`${t.base}/api/v1/blogs/anna/stats`)).json();
    assert.equal(apiStats.data.posts, 1);
    assert.equal(apiStats.data.likes, 1);
    assert.equal(apiStats.data.followers, 1);

    // Страница статистики — только владелец
    const guest = await createAgent(t.base);
    const guestPage = await guest.get('/stats');
    assert.equal(guestPage.res.status, 302);
    const ownerPage = await a.agent.get('/stats');
    assert.match(ownerPage.html, /Статистика блога/);
    assert.match(ownerPage.html, /пост для статистики/);
  } finally {
    await t.close();
  }
});
