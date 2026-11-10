// Тесты разметки композера: кнопки действий и смайлпикер.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerAgent } from './helpers.js';

test('композер: без «Предпросмотра»/«Свернуть», смайлпикер и действия по краям', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, {
      email: 'composer@example.com', password: 'password123', slug: 'composer', title: 'Композер',
    });
    const dash = await a.agent.get('/dashboard');
    assert.equal(dash.res.status, 200);

    assert.doesNotMatch(dash.html, /js-composer-collapse/);
    assert.doesNotMatch(dash.html, /formaction="\/posts\/preview"/);

    const form = dash.html.match(/<form class="composer-form js-composer-form" data-type="text"[\s\S]*?<\/form>/)?.[0];
    assert.ok(form, 'текстовая форма композера найдена');
    assert.match(form, /js-emoji-toggle/);
    assert.match(form, /composer-actions-left/);
    assert.match(form, /composer-actions-right/);

    const draft = form.indexOf('value="draft"');
    const emoji = form.indexOf('js-emoji-toggle');
    const publish = form.indexOf('value="publish"');
    assert.ok(draft >= 0 && emoji > draft && publish > emoji, 'слева черновик и смайлик, справа публикация');

    // В свёрнутом композере «Текст» не должен быть активным.
    const textButton = dash.html.match(/<button[^>]*data-type="text"[^>]*>/)?.[0] ?? '';
    assert.doesNotMatch(textButton, /is-active/);
    assert.match(textButton, /aria-pressed="false"/);
  } finally {
    await t.close();
  }
});
