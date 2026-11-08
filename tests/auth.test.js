// Тесты аккаунтов: регистрация, вход/выход, сессии, CSRF, seed админа.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent } from './helpers.js';

test('регистрация создаёт пользователя и блог, выдаёт сессию', async () => {
  const t = await createTestApp();
  try {
    const { agent, status, location } = await registerAgent(t.base, {
      email: 'marta@example.com',
      password: 'parol-1234',
      slug: 'marta',
      title: 'Блог Марта',
    });
    assert.equal(status, 303);
    assert.equal(location, '/dashboard');

    const user = t.ctx.db.prepare('SELECT * FROM users WHERE email = ?').get('marta@example.com');
    assert.ok(user, 'пользователь создан');
    assert.ok(user.password_hash.startsWith('$argon2id$'), 'пароль — argon2id');

    const blog = t.ctx.db.prepare('SELECT * FROM blogs WHERE user_id = ?').get(user.id);
    assert.equal(blog.slug, 'marta');
    assert.equal(blog.title, 'Блог Марта');

    const dash = await agent.get('/dashboard');
    assert.equal(dash.res.status, 200);
    assert.match(dash.html, /Блог Марта/);
  } finally {
    await t.close();
  }
});

test('дубликат email отклоняется с 422 и понятной ошибкой', async () => {
  const t = await createTestApp();
  try {
    await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'aaa' });
    const { status } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'bbb' });
    assert.equal(status, 422);
    const count = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    assert.equal(count, 1);
  } finally {
    await t.close();
  }
});

test('занятый slug и некорректный slug отклоняются', async () => {
  const t = await createTestApp();
  try {
    await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'same' });
    const taken = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'same' });
    assert.equal(taken.status, 422);
    const bad = await registerAgent(t.base, { email: 'c@example.com', password: 'parol-1234', slug: 'Плохой Слуг!' });
    assert.equal(bad.status, 422);
    const upper = await registerAgent(t.base, { email: 'd@example.com', password: 'parol-1234', slug: 'UPPER' });
    assert.equal(upper.status, 422);
  } finally {
    await t.close();
  }
});

test('слабый пароль отклоняется', async () => {
  const t = await createTestApp();
  try {
    const { status } = await registerAgent(t.base, { email: 'a@example.com', password: '123', slug: 'aaa' });
    assert.equal(status, 422);
  } finally {
    await t.close();
  }
});

test('вход с верным и неверным паролем', async () => {
  const t = await createTestApp();
  try {
    await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'aaa' });

    const agent = await createAgent(t.base);
    await agent.get('/login');
    const bad = await agent.postForm('/login', { _csrf: agent.csrf, email: 'a@example.com', password: 'wrong-pass' });
    assert.equal(bad.status, 422);

    const ok = await agent.postForm('/login', { _csrf: agent.csrf, email: 'a@example.com', password: 'parol-1234' });
    assert.equal(ok.status, 303);
    const dash = await agent.get('/dashboard');
    assert.equal(dash.res.status, 200);

    const ghost = await createAgent(t.base);
    const dashGuest = await ghost.get('/dashboard');
    assert.equal(dashGuest.res.status, 302);
  } finally {
    await t.close();
  }
});

test('выход уничтожает сессию', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'aaa' });
    const out = await agent.postForm('/logout', { _csrf: agent.csrf });
    assert.equal(out.status, 303);
    const dash = await agent.get('/dashboard');
    assert.equal(dash.res.status, 302);
    const sessions = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    assert.equal(sessions, 0);
  } finally {
    await t.close();
  }
});

test('POST без CSRF-токена отклоняется с 403', async () => {
  const t = await createTestApp();
  try {
    const res = await fetch(`${t.base}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=x%40example.com&password=whatever1',
    });
    assert.equal(res.status, 403);
  } finally {
    await t.close();
  }
});

test('seed администратора из переменных окружения', async () => {
  const t = await createTestApp({ admin: { email: 'boss@example.com', password: 'admin-pass-1' } });
  try {
    const admin = t.ctx.db.prepare('SELECT * FROM users WHERE role = ?').get('admin');
    assert.ok(admin, 'администратор создан');
    assert.equal(admin.email, 'boss@example.com');
    const blog = t.ctx.db.prepare('SELECT * FROM blogs WHERE user_id = ?').get(admin.id);
    assert.ok(blog, 'у администратора есть блог');

    // Повторный seed ничего не ломает
    const n = t.ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    assert.equal(n, 1);
  } finally {
    await t.close();
  }
});

test('просроченная сессия удаляется при обращении', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'aaa' });
    t.ctx.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
    const dash = await agent.get('/dashboard');
    assert.equal(dash.res.status, 302);
    const sessions = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    assert.equal(sessions, 0);
  } finally {
    await t.close();
  }
});
