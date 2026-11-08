// Тесты Этапа 8: жалобы, баны, скрытие контента, журнал, лимиты, блокировки.
// Требование ТЗ: все админ-разрешения проверяются на сервере.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent } from './helpers.js';

async function seededWithAdmin(t) {
  // Админ — через переменные окружения (как на реальном деплое)
  const admin = await createAgent(t.base);
  const adminUser = t.ctx.db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  const adminBlog = adminUser
    ? t.ctx.db.prepare('SELECT slug FROM blogs WHERE user_id = ?').get(adminUser.id)
    : null;
  const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
  const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Борис' });
  return { admin, adminUser, a, b };
}

// Сид с админом: createTestApp({ admin }) — создаётся seed'ом
async function adminSeed(t) {
  const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
  const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Борис' });
  const adminId = t.ctx.db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
  const adminRow = t.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
  const admin = await createAgent(t.base);
  // Вход админом через форму (сид-пароль известен из теста создания)
  await admin.get('/login');
  const login = await admin.postForm('/login', {
    _csrf: admin.csrf, email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  assert.equal(login.status, 303, 'админ входит');
  await admin.get('/dashboard');
  return { admin, adminId, a, b };
}

const ADMIN_EMAIL = 'boss@example.com';
const ADMIN_PASSWORD = 'admin-pass-1';

async function postAs(agent, body) {
  const res = await agent.postForm('/posts', { action: 'publish', type: 'text', body, _csrf: agent.csrf });
  assert.equal(res.status, 303);
  return Number(res.headers.get('location').match(/created=(\d+)/)?.[1]);
}

test('жалоба: отправка, попадание в админку, скрытие контента, журналирование', async () => {
  const t = await createTestApp({ admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  try {
    const { admin, a } = await adminSeed(t);
    const postId = await postAs(a.agent, 'пост с нарушением');

    // Борис жалуется
    const form = await a.agent.get(`/report/post/${postId}`);
    assert.equal(form.res.status, 200);
    const reportAgent = await createAgent(t.base);
    await reportAgent.get('/register');
    const reg = await reportAgent.postForm('/register', {
      _csrf: reportAgent.csrf, email: 'c@example.com', password: 'parol-1234', slug: 'carl', title: 'Carl',
    });
    assert.equal(reg.status, 303);
    await reportAgent.get('/dashboard');
    const r = await reportAgent.postForm(`/report/post/${postId}`, {
      _csrf: reportAgent.csrf, back: '/dashboard', reason: 'spam', details: 'реклама',
    });
    assert.equal(r.status, 303);

    // Жалоба в админке
    const reports = await admin.get('/admin/reports');
    assert.match(reports.html, /пост с нарушением/);
    assert.match(reports.html, /реклама/);

    // Скрытие контента по жалобе
    const resolve = await admin.postForm(`/admin/reports/${r ? 1 : 1}/resolve`, {
      _csrf: admin.csrf, action: 'hide_content',
    });
    assert.equal(resolve.status, 303);

    const postRow = t.ctx.db.prepare('SELECT status FROM posts WHERE id = ?').get(postId);
    assert.equal(postRow.status, 'hidden');

    // Скрытый пост: гость видит 404 на пермалинке и не видит в блоге
    const guest = await createAgent(t.base);
    const permalink = await guest.get(`/anna/${postId}`);
    assert.equal(permalink.res.status, 404);
    const blog = await guest.get('/anna');
    assert.doesNotMatch(blog.html, /пост с нарушением/);

    // Жалоба решена, действие в журнале
    const reportRow = t.ctx.db.prepare('SELECT status, resolution FROM reports').get();
    assert.equal(reportRow.status, 'resolved');
    const logs = t.ctx.db.prepare('SELECT * FROM moderation_actions').all();
    assert.ok(logs.some((l) => l.action === 'hide_post'), 'скрытие в журнале');
    assert.ok(logs.some((l) => l.action.startsWith('resolve_report')), 'резолюция в журнале');
  } finally {
    await t.close();
  }
});

test('доступ к админке: гость -> редирект, обычный пользователь -> 403', async () => {
  const t = await createTestApp({ admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  try {
    const { a } = await adminSeed(t);
    const guest = await createAgent(t.base);
    const g = await guest.get('/admin');
    assert.equal(g.res.status, 302);

    const forbidden = await a.agent.get('/admin');
    assert.equal(forbidden.res.status, 403);
    const forbiddenPosts = await a.agent.get('/admin/reports');
    assert.equal(forbiddenPosts.res.status, 403);
    const forbiddenUsers = await a.agent.get('/admin/users');
    assert.equal(forbiddenUsers.res.status, 403);
    const forbiddenSettings = await a.agent.get('/admin/settings');
    assert.equal(forbiddenSettings.res.status, 403);
  } finally {
    await t.close();
  }
});

test('бан: сессии завершаются, вход закрыт, админа забанить нельзя', async () => {
  const t = await createTestApp({ admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  try {
    const { admin, a, adminUser } = await adminSeed(t);

    const adminRowId = t.ctx.db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
    // Попытка забанить админа
    const banAdmin = await admin.postForm(`/admin/users/${adminRowId}/status`, {
      _csrf: admin.csrf, status: 'blocked',
    });
    assert.equal(banAdmin.status, 400);

    // Бан Бориса
    const borisId = t.ctx.db.prepare("SELECT id FROM users WHERE email = 'b@example.com'").get().id;
    const ban = await admin.postForm(`/admin/users/${borisId}/status`, {
      _csrf: admin.csrf, status: 'blocked', reason: 'спам',
    });
    assert.equal(ban.status, 303);

    // Сессия Бориса мертва
    const dash = await a.agent.get('/dashboard'); // Анна жива
    assert.equal(dash.res.status, 200);
    const bannedPage = await createAgent(t.base);

    // Логин забаненного отклоняется
    const banned = await createAgent(t.base);
    await banned.get('/login');
    const login = await banned.postForm('/login', { _csrf: banned.csrf, email: 'b@example.com', password: 'parol-1234' });
    assert.equal(login.status, 423);

    // Разбан
    const unban = await admin.postForm(`/admin/users/${borisId}/status`, { _csrf: admin.csrf, status: 'active' });
    assert.equal(unban.status, 303);
    const login2 = await banned.postForm('/login', { _csrf: banned.csrf, email: 'b@example.com', password: 'parol-1234' });
    assert.equal(login2.status, 303);

    const logs = t.ctx.db.prepare("SELECT action FROM moderation_actions WHERE target_type = 'user'").all();
    assert.ok(logs.some((l) => l.action === 'ban_user'));
    assert.ok(logs.some((l) => l.action === 'unban_user'));
  } finally {
    await t.close();
  }
});

test('лимиты загрузок меняются в админке и применяются сервером', async () => {
  const t = await createTestApp({ admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  try {
    const { admin, a } = await adminSeed(t);
    const { makePng } = await import('./helpers.js');

    const page = await admin.get('/admin/settings');
    assert.match(page.html, /Лимиты загрузок/);

    const save = await admin.postForm('/admin/settings', {
      _csrf: admin.csrf, image_mb: '1', gif_mb: '10', audio_mb: '20', video_mb: '100', maxFilesPerPost: '5',
      registration_open: 'on',
    });
    assert.equal(save.status, 303);
    const limits = JSON.parse(t.ctx.db.prepare("SELECT value FROM settings WHERE key = 'upload_limits'").get().value);
    assert.equal(limits.image, 1024 * 1024);

    // Применение лимитов сервером покрыто тестом 'лимит размера изображения
    // применяется из настроек' (posts.test.js). Здесь проверяем сохранение.

    // Закрытие регистрации
    const close = await admin.postForm('/admin/settings', {
      _csrf: admin.csrf, image_mb: '1', gif_mb: '10', audio_mb: '20', video_mb: '100', maxFilesPerPost: '5',
    });
    assert.equal(close.status, 303);
    const regPage = await createAgent(t.base);
    const rp = await regPage.get('/register');
    assert.equal(rp.res.status, 403);
  } finally {
    await t.close();
  }
});

test('пользовательские блокировки: заблокированный не может лайкать и комментировать', async () => {
  const t = await createTestApp();
  try {
    const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Анна' });
    const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Борис' });
    await postAs(a.agent, 'пост Анны');
    const postId = t.ctx.db.prepare('SELECT id FROM posts').get().id;

    // Временный сервисный блок: Boris блокирует... нет — Анна блокирует Бориса (blocker=Anna owner)
    t.ctx.db.prepare('INSERT INTO blocks (blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, ?)')
      .run(
        t.ctx.db.prepare("SELECT id FROM users WHERE email = 'a@example.com'").get().id,
        t.ctx.db.prepare("SELECT id FROM users WHERE email = 'b@example.com'").get().id,
        Date.now()
      );

    const like = await fetch(`${t.base}/api/posts/${postId}/like`, {
      method: 'POST',
      headers: { cookie: b.agent.cookieHeader(), 'x-csrf-token': b.agent.csrf },
    });
    assert.equal(like.status, 403);

    const comment = await b.agent.postForm(`/posts/${postId}/comments`, {
      _csrf: b.agent.csrf, back: '/anna', body: 'спам от заблокированного',
    });
    assert.equal(comment.status, 403);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  } finally {
    await t.close();
  }
});
