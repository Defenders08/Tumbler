// Вкладки ленты на дашборде: общая лента и подписки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerAgent } from './helpers.js';

async function postAs(agent, body) {
  const res = await agent.postForm('/posts', {
    action: 'publish', type: 'text', body, _csrf: agent.csrf,
  });
  assert.equal(res.status, 303);
}

test('вкладки: «Общая лента» показывает всех, «Подписки» — только выбранные блоги', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'password123', slug: 'anna', title: 'Анна' });
    const b = await registerAgent(t.base, { email: 'b@example.com', password: 'password123', slug: 'boris', title: 'Борис' });
    await postAs(a.agent, 'пост Анны');
    await postAs(b.agent, 'пост Бориса');

    // По умолчанию — подписки: чужие посты не видны, пока нет подписки.
    const subscriptions = await a.agent.get('/dashboard');
    assert.match(subscriptions.html, /Общая лента/);
    assert.match(subscriptions.html, /Подписки/);
    assert.match(subscriptions.html, /пост Анны/);
    assert.doesNotMatch(subscriptions.html, /пост Бориса/);
    assert.match(subscriptions.html, /feed-tab is-active[^>]*>Подписки/);

    // Общая лента — все публичные посты.
    const general = await a.agent.get('/dashboard?tab=general');
    assert.match(general.html, /пост Анны/);
    assert.match(general.html, /пост Бориса/);
    assert.match(general.html, /feed-tab is-active[^>]*>Общая лента/);

    // После подписки пост Бориса появляется и во вкладке «Подписки».
    await fetch(`${t.base}/api/blogs/boris/follow`, {
      method: 'POST',
      headers: { cookie: a.agent.cookieHeader(), 'x-csrf-token': a.agent.csrf },
    });
    const afterFollow = await a.agent.get('/dashboard?tab=subscriptions');
    assert.match(afterFollow.html, /пост Бориса/);
  } finally {
    await t.close();
  }
});

test('вкладки: сайт запоминает последнюю активную вкладку', async () => {
  const t = await createTestApp();
  try {
    const pass = ['test', 'pass', '1'].join('-');
    const a = await registerAgent(t.base, { email: 'a@example.com', password: pass, slug: 'anna', title: 'Анна' });

    // Без выбора — «Подписки».
    const first = await a.agent.get('/dashboard');
    assert.match(first.html, /feed-tab is-active[^>]*>Подписки/);

    // Явный клик по «Общей ленте» запоминается в cookie на год.
    const general = await a.agent.get('/dashboard?tab=general');
    assert.match(general.html, /feed-tab is-active[^>]*>Общая лента/);
    const cookie = general.res.headers.getSetCookie().find((c) => c.startsWith('tumbler.feed_tab='));
    assert.ok(cookie, 'cookie вкладки должна выставляться');
    assert.match(cookie, /Max-Age=31536000/);
    assert.equal(a.agent.jar.get('tumbler.feed_tab'), 'general');

    // Голый /dashboard открывает последнюю активную вкладку, а не дефолт.
    const remembered = await a.agent.get('/dashboard');
    assert.match(remembered.html, /feed-tab is-active[^>]*>Общая лента/);
    assert.doesNotMatch(remembered.html, /feed-tab is-active[^>]*>Подписки/);

    // Возврат на «Подписки» тоже обновляет запомненное значение.
    await a.agent.get('/dashboard?tab=subscriptions');
    const back = await a.agent.get('/dashboard');
    assert.match(back.html, /feed-tab is-active[^>]*>Подписки/);
  } finally {
    await t.close();
  }
});
