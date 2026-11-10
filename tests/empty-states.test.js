// Пустые состояния: без тегов и подписок в сайдбаре показывается заглушка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerAgent } from './helpers.js';

test('пустой сайдбар: «Пока тут ничего нет» в тегах и подписках', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, {
      email: 'empty@example.com', password: 'password123', slug: 'empty', title: 'Пусто',
    });
    const dash = await a.agent.get('/dashboard');
    assert.equal(dash.res.status, 200);
    assert.match(dash.html, /Мои теги/);
    assert.match(dash.html, /Подписки/);
    const placeholders = dash.html.match(/Пока тут ничего нет/g) ?? [];
    assert.ok(placeholders.length >= 2, 'заглушки в «Моих тегах» и «Подписках»');
  } finally {
    await t.close();
  }
});
