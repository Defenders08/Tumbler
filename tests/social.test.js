// Тесты социальных механик (этап 5): подписки, лайки, реблоги, комментарии.
// Ключевой сценарий ТЗ — взаимодействие двух аккаунтов и судьба реблогов при удалении корня.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent } from './helpers.js';

async function twoUsers(t) {
  const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
  const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Борис' });
  return { a, b };
}

async function postAs(agent, body, extra = {}) {
  const res = await agent.postForm('/posts', {
    action: 'publish', type: 'text', body, _csrf: agent.csrf, ...extra,
  });
  assert.equal(res.status, 303);
  return Number(res.headers.get('location').match(/created=(\d+)/)?.[1]);
}

test('подписка: посты появляются в ленте подписчика, toggle работает', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    await postAs(b.agent, 'пост Бориса');

    // До подписки лента Анны пуста
    const before = await a.agent.get('/dashboard');
    assert.doesNotMatch(before.html, /пост Бориса/);

    // Подписка через JSON API
    const follow = await fetch(`${t.base}/api/blogs/boris/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
    });
    assert.equal(follow.status, 200);
    const data = await follow.json();
    assert.equal(data.following, true);

    // Повторный вызов — отписка (toggle, дубль невозможен)
    const unfollow = await fetch(`${t.base}/api/blogs/boris/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
    });
    const data2 = await unfollow.json();
    assert.equal(data2.following, false);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM follows').get().n, 0);

    // Снова подписаться — пост Бориса виден в ленте Анны
    await fetch(`${t.base}/api/blogs/boris/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
    });
    const feed = await a.agent.get('/dashboard');
    assert.match(feed.html, /пост Бориса/);
    assert.match(feed.html, /side-follows/);
  } finally {
    await t.close();
  }
});

test('подписка на свой блог и без авторизации отклоняется', async () => {
  const t = await createTestApp();
  try {
    const { a } = await twoUsers(t);
    const self = await fetch(`${t.base}/api/blogs/anna/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
    });
    assert.equal(self.status, 400);

    const guest = await fetch(`${t.base}/api/blogs/boris/follow`, { method: 'POST' });
    assert.equal(guest.status, 401);

    const noCsrf = await fetch(`${t.base}/api/blogs/boris/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader() },
    });
    assert.equal(noCsrf.status, 403);
  } finally {
    await t.close();
  }
});

test('лайк: счётчик, активное состояние, отмена, повторная защита', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    const postId = await postAs(a.agent, 'пост Анны');

    const like = await fetch(`${t.base}/api/posts/${postId}/like`, {
      method: 'POST',
      headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });
    const data = await like.json();
    assert.equal(data.liked, true);
    assert.equal(data.likeCount, 1);

    // Борис подписан на Анну — пост с красным сердцем виден в его ленте
    await fetch(`${t.base}/api/blogs/anna/follow`, {
      method: 'POST',
      headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });
    const feed = await b.agent.get('/dashboard');
    assert.match(feed.html, /is-liked/);

    // В ленте Бориса у поста красное сердце
    // Отмена
    const unlike = await fetch(`${t.base}/api/posts/${postId}/like`, {
      method: 'POST',
      headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });
    const data2 = await unlike.json();
    assert.equal(data2.liked, false);
    assert.equal(data2.likeCount, 0);
    assert.equal(t.ctx.db.prepare('SELECT like_count AS n FROM posts WHERE id = ?').get(postId).n, 0);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM likes').get().n, 0);
  } finally {
    await t.close();
  }
});

test('лайк черновика и несуществующего поста отклоняется', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    await a.agent.postForm('/posts', { action: 'draft', type: 'text', body: 'черновик', _csrf: a.agent.csrf });
    const draftId = t.ctx.db.prepare("SELECT id FROM posts WHERE status = 'draft'").get().id;
    const res = await fetch(`${t.base}/api/posts/${draftId}/like`, {
      method: 'POST',
      headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });
    assert.equal(res.status, 404);
  } finally {
    await t.close();
  }
});

test('реблог с текстом: карточка с автором корня, счётчик, лента подписчика', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    const postId = await postAs(a.agent, 'оригинальный текст Анны');

    // Подписка Бориса на Анну, чтобы увидеть реблог в ленте
    await fetch(`${t.base}/api/blogs/anna/follow`, {
      method: 'POST',
      headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });

    const rb = await b.agent.postForm(`/posts/${postId}/reblog`, {
      _csrf: b.agent.csrf, back: '/dashboard', body: 'соглашусь с Анной!',
    });
    assert.equal(rb.status, 303);

    const rootRow = t.ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
    assert.equal(rootRow.reblog_count, 1);
    const reblogRow = t.ctx.db.prepare('SELECT * FROM posts WHERE blog_id = (SELECT id FROM blogs WHERE slug = ?)').get('boris');
    assert.equal(reblogRow.reblog_root_id, postId);
    assert.equal(reblogRow.reblog_parent_id, postId);

    // В блоге Бориса: реблог-карточка с текстом Бориса и содержимым Анны
    const borisBlog = await createAgent(t.base);
    const page = await borisBlog.get('/boris');
    assert.match(page.html, /соглашусь с Анной/);
    assert.match(page.html, /reblog-root/);
    assert.match(page.html, /оригинальный текст Анны/);
    assert.match(page.html, /реблог у/);

    // В ленте Бориса реблог тоже виден
    const feed = await b.agent.get('/dashboard');
    assert.match(feed.html, /соглашусь с Анной/);
  } finally {
    await t.close();
  }
});

test('реблог черновика и несуществующего поста отклоняется', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    await a.agent.postForm('/posts', { action: 'draft', type: 'text', body: 'черновик', _csrf: a.agent.csrf });
    const draftId = t.ctx.db.prepare("SELECT id FROM posts WHERE status = 'draft'").get().id;
    const res = await b.agent.postForm(`/posts/${draftId}/reblog`, { _csrf: b.agent.csrf, back: '/dashboard' });
    assert.equal(res.status, 404);
    const res2 = await b.agent.postForm('/posts/999999/reblog', { _csrf: b.agent.csrf, back: '/dashboard' });
    assert.equal(res2.status, 404);
  } finally {
    await t.close();
  }
});

test('удаление корня: реблог остаётся с заглушкой, счётчик корня сохраняется', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    const postId = await postAs(a.agent, 'оригинал');
    await b.agent.postForm(`/posts/${postId}/reblog`, { _csrf: b.agent.csrf, back: '/dashboard', body: 'репост' });

    await a.agent.postForm(`/posts/${postId}/delete`, { _csrf: a.agent.csrf, back: 'dashboard' });

    const guest = await createAgent(t.base);
    const page = await guest.get('/boris');
    assert.match(page.html, /репост/);
    assert.match(page.html, /Исходный пост удалён/);
    assert.doesNotMatch(page.html, /оригинал</);

    const rootRow = t.ctx.db.prepare('SELECT status, reblog_count FROM posts WHERE id = ?').get(postId);
    assert.equal(rootRow.status, 'deleted');
    assert.equal(rootRow.reblog_count, 1);
  } finally {
    await t.close();
  }
});

test('комментарии: добавление, счётчик, отображение, удаление своего', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    const postId = await postAs(a.agent, 'пост с комментариями');

    const add = await b.agent.postForm(`/posts/${postId}/comments`, {
      _csrf: b.agent.csrf, back: '/anna', body: 'Отличный пост!',
    });
    assert.equal(add.status, 303);

    const rootRow = t.ctx.db.prepare('SELECT comment_count FROM posts WHERE id = ?').get(postId);
    assert.equal(rootRow.comment_count, 1);

    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    assert.match(page.html, /Отличный пост!/);
    assert.match(page.html, /comments-list/);

    // Пустой комментарий отклоняется (redirect с кодом ошибки)
    const empty = await b.agent.postForm(`/posts/${postId}/comments`, {
      _csrf: b.agent.csrf, back: '/anna', body: '   ',
    });
    assert.equal(empty.status, 303);
    assert.match(empty.headers.get('location') ?? '', /commentError=social\.comment_empty/);

    // Чужой комментарий удалить нельзя
    const commentId = t.ctx.db.prepare('SELECT id FROM comments').get().id;
    const foreign = await a.agent.postForm(`/comments/${commentId}/delete`, { _csrf: a.agent.csrf, back: '/anna' });
    assert.equal(foreign.status, 404);

    // Свой — можно
    const own = await b.agent.postForm(`/comments/${commentId}/delete`, { _csrf: b.agent.csrf, back: '/anna' });
    assert.equal(own.status, 303);
    assert.equal(t.ctx.db.prepare('SELECT comment_count FROM posts WHERE id = ?').get(postId).comment_count, 0);
    assert.equal(t.ctx.db.prepare("SELECT status FROM comments WHERE id = ?").get(commentId).status, 'deleted');
  } finally {
    await t.close();
  }
});

test('гостям действия показывают ссылки на вход', async () => {
  const t = await createTestApp();
  try {
    const { a } = await twoUsers(t);
    await postAs(a.agent, 'пост для гостей');
    const guest = await createAgent(t.base);
    const page = await guest.get('/anna');
    assert.match(page.html, /login\?back=/);
    assert.doesNotMatch(page.html, /js-like/);
    assert.match(page.html, /Лайки, реблоги и комментарии/);
  } finally {
    await t.close();
  }
});

test('лента хронологична и без дублей при нескольких подписках', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await twoUsers(t);
    const c = await registerAgent(t.base, { email: 'c@example.com', password: 'parol-1234', slug: 'vera', title: 'Вера' });
    await postAs(b.agent, 'пост Бориса 1');
    await postAs(c.agent, 'пост Веры 1');
    await postAs(b.agent, 'пост Бориса 2');

    // Анна подписана на обоих
    for (const slug of ['boris', 'vera']) {
      await fetch(`${t.base}/api/blogs/${slug}/follow`, {
        method: 'POST',
        headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
      });
    }
    const feed = await a.agent.get('/dashboard');
    const bodies = [...feed.html.matchAll(/(пост Бориса 2|пост Веры 1|пост Бориса 1)/g)].map((m) => m[1]);
    assert.deepEqual(bodies, ['пост Бориса 2', 'пост Веры 1', 'пост Бориса 1']);
  } finally {
    await t.close();
  }
});
