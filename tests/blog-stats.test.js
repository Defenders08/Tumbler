// Блок статистики блога: подписчики, подписки и действия.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent } from './helpers.js';

async function follow(t, agent, slug) {
  const res = await fetch(`${t.base}/api/blogs/${slug}/follow`, {
    method: 'POST',
    headers: { cookie: agent.cookieHeader(), 'x-csrf-token': agent.csrf },
  });
  assert.equal(res.status, 200);
}

test('блог: под аватаром видны подписчики, подписки и действия', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'password123', slug: 'anna', title: 'Анна' });
    const b = await registerAgent(t.base, { email: 'b@example.com', password: 'password123', slug: 'boris', title: 'Борис' });
    const c = await registerAgent(t.base, { email: 'c@example.com', password: 'password123', slug: 'vera', title: 'Вера' });

    await follow(t, a.agent, 'vera'); // Анна подписана на Веру
    await follow(t, b.agent, 'anna'); // Борис подписан на Анну

    const page = await b.agent.get('/anna');
    assert.match(page.html, /blog-stats/);
    assert.match(page.html, /js-followers-count">1</, 'подписчиков: 1');
    assert.match(page.html, /Подписчики/);
    assert.match(page.html, /Подписки/);
    assert.match(page.html, /js-follow[\s"]/);
    assert.match(page.html, /Вы подписаны/);
    assert.match(page.html, /Задать вопрос/);

    // Владельцу кнопка подписки не показывается, вопрос — остаётся.
    const owner = await a.agent.get('/anna');
    assert.doesNotMatch(owner.html, /js-follow[\s"]/);
    assert.match(owner.html, /Задать вопрос/);

    // Гость видит кнопку подписки со ссылкой на вход и вопрос.
    const guest = await createAgent(t.base);
    const guestPage = await guest.get('/anna');
    assert.match(guestPage.html, /login\?back=\/anna/);
    assert.match(guestPage.html, /Задать вопрос/);
  } finally {
    await t.close();
  }
});
