// Настройки блога: три независимых блока сохраняются, не затирая друг друга.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerAgent } from './helpers.js';

test('настройки: профиль, оформление и соцнастройки сохраняются независимо', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, {
      email: 'settings@example.com', password: 'password123', slug: 'settings', title: 'Настройки',
    });

    // Полная старая форма задаёт исходное состояние.
    await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf,
      title: 'Старое имя',
      description: 'Старое описание',
      accent_color: '#ff8800',
      ask_enabled: 'on',
      ask_anonymous: 'on',
      timezone: 'Europe/Moscow',
    });

    // 1. Профиль: меняет только название/описание.
    await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, section: 'profile', title: 'Новое имя', description: 'Новое описание',
    });
    let blog = t.ctx.db.prepare('SELECT * FROM blogs WHERE slug = ?').get('settings');
    let user = t.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(blog.user_id);
    assert.equal(blog.title, 'Новое имя');
    assert.equal(blog.description, 'Новое описание');
    assert.equal(JSON.parse(blog.theme).accentColor, '#ff8800', 'акцент не сброшен');
    assert.equal(blog.ask_enabled, 1, 'Ask box не выключен');
    assert.equal(user.timezone, 'Europe/Moscow');

    // 2. Оформление: меняет только акцент.
    await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, section: 'appearance', accent_color: '#123456',
    });
    blog = t.ctx.db.prepare('SELECT * FROM blogs WHERE slug = ?').get('settings');
    assert.equal(JSON.parse(blog.theme).accentColor, '#123456');
    assert.equal(blog.title, 'Новое имя');
    assert.equal(blog.ask_enabled, 1);

    // 3. Соцнастройки: меняют Ask/анонимность/пояс.
    await a.agent.postForm('/settings/blog', {
      _csrf: a.agent.csrf, section: 'social', timezone: 'Europe/Berlin',
    });
    blog = t.ctx.db.prepare('SELECT * FROM blogs WHERE slug = ?').get('settings');
    user = t.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(blog.user_id);
    assert.equal(blog.ask_enabled, 0);
    assert.equal(blog.ask_anonymous, 0);
    assert.equal(user.timezone, 'Europe/Berlin');
    assert.equal(JSON.parse(blog.theme).accentColor, '#123456', 'акцент не сброшен');

    // Страница содержит три блока без шапок и заполненные контролы.
    const page = await a.agent.get('/settings/blog');
    assert.doesNotMatch(page.html, /Редактирование блога|Кастомизация блога|Настройки соц сети/);
    assert.doesNotMatch(page.html, /settings-card-head|← Дашборд/);
    assert.match(page.html, /name="avatar"/);
    assert.match(page.html, /name="accent_color" value="#123456"/);
    assert.match(page.html, /name="timezone"/);
    assert.match(page.html, /value="Europe\/Berlin" selected/);
  } finally {
    await t.close();
  }
});
