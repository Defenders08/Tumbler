// Тесты Этапа 7: планировщик (расписание + очередь, рестарт, дубли) и уведомления.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent } from './helpers.js';
import { tick, localToUtcEpoch, QUEUE_INTERVAL_MS } from '../src/scheduler/index.js';
import { openDatabase } from '../src/db/connection.js';
import { unreadCount } from '../src/modules/notifications/service.js';

async function createPostWithAction(agent, action, extra = {}) {
  const res = await agent.postForm('/posts', {
    action, type: 'text', body: `пост ${action} ${Math.random().toString(36).slice(2, 6)}`,
    _csrf: agent.csrf, ...extra,
  });
  return res;
}

test('конвертация часового пояса: localToUtcEpoch', () => {
  // 10:00 в Москве (UTC+3) = 07:00 UTC
  const moscow = localToUtcEpoch('2026-11-08T10:00', 'Europe/Moscow');
  assert.equal(new Date(moscow).toISOString(), '2026-11-08T07:00:00.000Z');
  // 10:00 в UTC = 10:00 UTC
  const utc = localToUtcEpoch('2026-11-08T10:00', 'UTC');
  assert.equal(new Date(utc).toISOString(), '2026-11-08T10:00:00.000Z');
  // Невалидная строка -> NaN
  assert.ok(Number.isNaN(localToUtcEpoch('мусор', 'UTC')));
});

test('запланированный пост публикуется ровно один раз, даже после «перезапуска»', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna' });
    const res = await createPostWithAction(agent, 'schedule', { scheduled_at_local: '2030-01-01T12:00' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /\/queue/);

    let row = t.ctx.db.prepare('SELECT status, scheduled_at FROM posts').get();
    assert.equal(row.status, 'scheduled');
    assert.ok(row.scheduled_at > Date.now(), 'время в будущем');

    // «Перематываем время»: пост становится просроченным
    t.ctx.db.prepare('UPDATE posts SET scheduled_at = ?').run(Date.now() - 1000);

    // Первый тик публикует
    const first = tick(t.ctx.db);
    assert.equal(first.scheduled, 1);
    row = t.ctx.db.prepare('SELECT status, published_at FROM posts').get();
    assert.equal(row.status, 'published');
    assert.ok(row.published_at);

    // Повторные тики не дублируют
    const second = tick(t.ctx.db);
    assert.equal(second.scheduled, 0);
    const count = t.ctx.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'").get().n;
    assert.equal(count, 1);
  } finally {
    await t.close();
  }
});

test('планировщик переживает рестарт: состояние в базе, не в памяти', async () => {
  const fs = await import('node:fs/promises');
  const t = await createTestApp();
  const dbPath = t.ctx.config.dbPath;
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna' });
    const res = await createPostWithAction(agent, 'schedule', { scheduled_at_local: '2030-01-01T12:00' });
    assert.equal(res.status, 303);
    // Отматываем время: пост просрочен к моменту «рестарта»
    t.ctx.db.prepare('UPDATE posts SET scheduled_at = ?').run(Date.now() - 1000);
    await t.close({ keepFiles: true }); // «остановка сервера»: база остаётся на диске

    // «Рестарт»: чистое переоткрытие базы и прогон тика
    const db2 = openDatabase(dbPath);
    assert.equal(db2.prepare('SELECT status FROM posts').get().status, 'scheduled');
    tick(db2);
    assert.equal(db2.prepare('SELECT status FROM posts').get().status, 'published');
    db2.close();
  } finally {
    await fs.rm(t.tmp, { recursive: true, force: true });
  }
});

test('очередь: публикует по одному, интервал соблюдается', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna' });
    await createPostWithAction(agent, 'queue');
    await createPostWithAction(agent, 'queue');
    await createPostWithAction(agent, 'queue');
    assert.equal(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'queued'").get().n, 3);

    // Первый тик: один пост из очереди
    const first = tick(t.ctx.db);
    assert.equal(first.queued, 1);
    // Сразу второй тик: интервал не прошёл — ничего
    const second = tick(t.ctx.db);
    assert.equal(second.queued, 0);
    // Симулируем прошедший интервал: отодвигаем published_at последней очередной публикации
    t.ctx.db.prepare("UPDATE posts SET published_at = ? WHERE status = 'published' AND queued_at IS NOT NULL")
      .run(Date.now() - QUEUE_INTERVAL_MS - 1000);
    const third = tick(t.ctx.db);
    assert.equal(third.queued, 1);
    assert.equal(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'queued'").get().n, 1);
  } finally {
    await t.close();
  }
});

test('страница очереди: расписание и очередь видны, отмена возвращает в черновики', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna' });
    await createPostWithAction(agent, 'queue');
    await createPostWithAction(agent, 'schedule', { scheduled_at_local: '2030-01-01T12:00' });

    const page = await agent.get('/queue');
    assert.match(page.html, /По расписанию/);
    assert.match(page.html, /Очередь/);

    const scheduledId = t.ctx.db.prepare("SELECT id FROM posts WHERE status = 'scheduled'").get().id;
    const cancel = await agent.postForm(`/posts/${scheduledId}/cancel`, { _csrf: agent.csrf });
    assert.equal(cancel.status, 303);
    assert.equal(t.ctx.db.prepare("SELECT status FROM posts WHERE id = ?").get(scheduledId).status, 'draft');
  } finally {
    await t.close();
  }
});

test('уведомления: лайк, подписка, комментарий, реблог, вопрос; свои действия — нет', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Борис' });

    // Борис включает ask
    await b.agent.postForm('/settings/blog', {
      _csrf: b.agent.csrf, title: 'Мир Бориса', description: '', ask_enabled: 'on',
      bg_color: '#f2f4f7', accent_color: '#2f9dd6', text_color: '#444444', font: 'helvetica',
    });
    // Анна пишет пост
    await a.agent.postForm('/posts', { action: 'publish', type: 'text', body: 'пост Анны', _csrf: a.agent.csrf });
    const postId = t.ctx.db.prepare('SELECT id FROM posts').get().id;

    // Борис лайкает, подписывается, комментирует, реблогает, задаёт вопрос
    await fetch(`${t.base}/api/posts/${postId}/like`, { method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf } });
    await fetch(`${t.base}/api/blogs/anna/follow`, { method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf } });
    await b.agent.postForm(`/posts/${postId}/comments`, { _csrf: b.agent.csrf, back: '/anna', body: 'комментарий' });
    await b.agent.postForm(`/posts/${postId}/reblog`, { _csrf: b.agent.csrf, back: '/dashboard', body: 'репост' });
    const askPage = await a.agent.get('/boris/ask');
    const token = askPage.html.match(/name="_csrf" value="([^"]+)"/)[1];
    await fetch(`${t.base}/boris/ask`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: a.agent.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: token, question: 'вопрос?' }).toString(),
    });

    // Анна: 4 уведомления (лайк, подписка, комментарий, реблог)
    assert.ok(unreadCount(t.ctx.db, t.ctx.db.prepare("SELECT id FROM users WHERE email = 'a@example.com'").get().id) >= 4);
    // Борис: 1 (вопрос); своего реблога себе — нет
    const borisId = t.ctx.db.prepare("SELECT id FROM users WHERE email = 'b@example.com'").get().id;
    assert.equal(unreadCount(t.ctx.db, borisId), 1);

    // Страница уведомлений Анны показывает события и отмечает прочитанным
    const page = await a.agent.get('/notifications');
    assert.match(page.html, /лайкнул/);
    assert.match(page.html, /подписался/);
    assert.match(page.html, /прокомментировал/);
    assert.match(page.html, /реблогнул/);
    assert.equal(unreadCount(t.ctx.db, t.ctx.db.prepare("SELECT id FROM users WHERE email = 'a@example.com'").get().id), 0);

    // Повторный лайк после отмены не дублирует уведомление (UNIQUE)
    await fetch(`${t.base}/api/posts/${postId}/like`, { method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf } }); // unlike
    await fetch(`${t.base}/api/posts/${postId}/like`, { method: 'POST', headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf } }); // like again
    const total = t.ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'like'").get().n;
    assert.equal(total, 1, 'уведомление о лайке не дублируется благодаря UNIQUE-индексу');
  } finally {
    await t.close();
  }
});

test('уведомления доступны только владельцу', async () => {
  const t = await createTestApp();
  try {
    const guest = await createAgent(t.base);
    const res = await guest.get('/notifications');
    assert.equal(res.res.status, 302);
  } finally {
    await t.close();
  }
});
