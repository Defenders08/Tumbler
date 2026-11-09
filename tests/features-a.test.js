// Тесты этапа A: приватные посты, закрепление, видео/аудио по ссылке, подписка на теги.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent, makeAnimatedGif, makeMp3 } from './helpers.js';

async function users(t) {
  const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
  const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Борис' });
  return { a, b };
}

async function postAs(agent, fields) {
  const res = await agent.postForm('/posts', { action: 'publish', type: 'text', _csrf: agent.csrf, ...fields });
  assert.equal(res.status, 303, `пост должен создаться: ${res.status}`);
  return Number(res.headers.get('location').match(/created=(\d+)/)?.[1]);
}

test('приватный пост: видят владелец и подписчики, остальным 404', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await users(t);
    const publicId = await postAs(a.agent, { body: 'публичный текст', tags: 'общий' });
    const privateId = await postAs(a.agent, { body: 'секрет для подписчиков', visibility: 'private' });

    // Борис подписан на Анну → видит приватный в блоге и на пермалинке
    await fetch(`${t.base}/api/blogs/anna/follow`, {
      method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });
    const followerBlog = await b.agent.get('/anna');
    assert.match(followerBlog.html, /секрет для подписчиков/);
    const followerPermalink = await b.agent.get(`/anna/${privateId}`);
    assert.equal(followerPermalink.res.status, 200);

    // Гость: приватного нет нигде
    const guest = await createAgent(t.base);
    const guestBlog = await guest.get('/anna');
    assert.doesNotMatch(guestBlog.html, /секрет для подписчиков/);
    assert.match(guestBlog.html, /публичный текст/);
    const guestPermalink = await guest.get(`/anna/${privateId}`);
    assert.equal(guestPermalink.res.status, 404);

    // Не в поиске и не в API
    const search = await (await fetch(`${t.base}/api/v1/search?q=${encodeURIComponent('секрет')}`)).json();
    assert.equal(search.data.posts.length, 0);
    const api = await (await fetch(`${t.base}/api/v1/posts`)).json();
    assert.equal(api.meta.total, 1, 'только публичный пост');

    // Отписка → доступ пропадает
    await fetch(`${t.base}/api/blogs/anna/follow`, {
      method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });
    const after = await b.agent.get(`/anna/${privateId}`);
    assert.equal(after.res.status, 404);
  } finally {
    await t.close();
  }
});

test('закрепление: пост поднимается вверху блога с бейджем, открепление возвращает хронологию', async () => {
  const t = await createTestApp();
  try {
    const { a } = await users(t);
    const first = await postAs(a.agent, { body: 'старый пост' });
    const second = await postAs(a.agent, { body: 'новый пост' });

    // Закрепляем СТАРЫЙ
    const pin = await a.agent.postForm(`/posts/${first}/pin`, { _csrf: a.agent.csrf, back: '/anna' });
    assert.equal(pin.status, 303);
    const pinnedRow = t.ctx.db.prepare('SELECT pinned_at FROM posts WHERE id = ?').get(first);
    assert.ok(pinnedRow.pinned_at);

    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    const order = [...page.html.matchAll(/(старый пост|новый пост)/g)].map((m) => m[1]);
    assert.deepEqual(order, ['старый пост', 'новый пост'], 'закреплённый первым');
    assert.match(page.html, /Закреплено/);

    // Открепление
    const unpin = await a.agent.postForm(`/posts/${first}/unpin`, { _csrf: a.agent.csrf, back: '/anna' });
    assert.equal(unpin.status, 303);
    const page2 = await guest.get('/anna');
    const order2 = [...page2.html.matchAll(/(старый пост|новый пост)/g)].map((m) => m[1]);
    assert.deepEqual(order2, ['новый пост', 'старый пост']);
  } finally {
    await t.close();
  }
});

test('видео по ссылке: YouTube embed создаётся, чужие домены отклоняются', async () => {
  const t = await createTestApp();
  try {
    const { a } = await users(t);
    const ok = await a.agent.postForm('/posts', {
      action: 'publish', type: 'video',
      link_url: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'Клип 2012', _csrf: a.agent.csrf,
    });
    assert.equal(ok.status, 303, 'видео по ссылке создаётся без файла');
    const blog = await a.agent.get('/anna');
    assert.match(blog.html, /youtube\.com\/embed\/dQw4w9WgXcQ/);
    assert.match(blog.html, /embed-box/);

    const bad = await a.agent.postForm('/posts', {
      action: 'publish', type: 'video', link_url: 'https://evil.example.com/x', _csrf: a.agent.csrf,
    });
    assert.equal(bad.status, 422);
  } finally {
    await t.close();
  }
});

test('аудио по ссылке: SoundCloud embed; файл и ссылка вместе отклоняются', async () => {
  const t = await createTestApp();
  try {
    const { a } = await users(t);
    const ok = await a.agent.postForm('/posts', {
      action: 'publish', type: 'audio',
      link_url: 'https://soundcloud.com/artist/track',
      title: 'Трек', _csrf: a.agent.csrf,
    });
    assert.equal(ok.status, 303);
    const blog = await a.agent.get('/anna');
    assert.match(blog.html, /w\.soundcloud\.com\/player/);

    const { makeMp3 } = await import('./helpers.js');
    const both = await a.agent.postMultipart('/posts', {
      action: 'publish', type: 'audio', link_url: 'https://soundcloud.com/artist/track2', _csrf: a.agent.csrf,
    }, [{ field: 'file', data: makeMp3(), mime: 'audio/mpeg', name: 'song.mp3' }]);
    assert.equal(both.status, 422, 'файл + ссылка одновременно нельзя');
  } finally {
    await t.close();
  }
});

test('подписка на тег: кнопка на странице тега, блок «Мои теги» в сайдбаре', async () => {
  const t = await createTestApp();
  try {
    const { a } = await users(t);
    await postAs(a.agent, { body: 'пост про дизайн', tags: 'дизайн' });

    const page = await a.agent.get('/tag/дизайн');
    assert.match(page.html, /tag\/дизайн\/follow/);

    // Подписка через API
    const follow = await fetch(`${t.base}/api/tags/дизайн/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
    });
    assert.equal(follow.status, 200);
    const data = await follow.json();
    assert.equal(data.following, true);

    const dash = await a.agent.get('/dashboard');
    assert.match(dash.html, /Мои теги/);
    assert.match(dash.html, /#дизайн/);

    // Отписка
    const unfollow = await fetch(`${t.base}/api/tags/дизайн/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
    });
    assert.equal((await unfollow.json()).following, false);
  } finally {
    await t.close();
  }
});
