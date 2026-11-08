// Тесты фундамента: миграции, /health, 404, статика.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

test('миграции идемпотентны: второй прогон не применяет ничего', async () => {
  const t = await createTestApp();
  try {
    const appliedAgain = migrate(t.ctx.db);
    assert.equal(appliedAgain, 0);
    const tables = t.ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    for (const expected of ['settings', 'users', 'sessions', 'blogs', 'media', 'posts', 'post_media', 'tags', 'post_tags', 'migrations']) {
      assert.ok(tables.includes(expected), `таблица ${expected} должна существовать`);
    }
  } finally {
    await t.close();
  }
});

test('внешние ключи включены (PRAGMA foreign_keys)', async () => {
  const t = await createTestApp();
  try {
    assert.equal(t.ctx.db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(t.ctx.db.pragma('journal_mode', { simple: true }), 'wal');
  } finally {
    await t.close();
  }
});

test('GET /health отдаёт JSON со статусом ok', async () => {
  const t = await createTestApp();
  try {
    const res = await fetch(`${t.base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime, 'number');
  } finally {
    await t.close();
  }
});

test('неизвестная страница вне шаблона slug: HTML 404', async () => {
  const t = await createTestApp();
  try {
    const res = await fetch(`${t.base}/internal/missing-page`);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /не найдена/i);
  } finally {
    await t.close();
  }
});

test('несуществующий slug-блог тоже даёт 404', async () => {
  const t = await createTestApp();
  try {
    const res = await fetch(`${t.base}/this-page-does-not-exist`);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /не существует|не найдена/i);
  } finally {
    await t.close();
  }
});

test('неизвестный API-маршрут: JSON 404', async () => {
  const t = await createTestApp();
  try {
    const res = await fetch(`${t.base}/api/nothing`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'not_found');
  } finally {
    await t.close();
  }
});

test('статика доступна: CSS и favicon', async () => {
  const t = await createTestApp();
  try {
    const css = await fetch(`${t.base}/static/css/tumbler.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
    const icon = await fetch(`${t.base}/static/favicon.svg`);
    assert.equal(icon.status, 200);
  } finally {
    await t.close();
  }
});

test('WAL-база переживает переоткрытие соединения', async () => {
  const t = await createTestApp();
  const dbPath = t.ctx.config.dbPath;
  try {
    t.ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('probe', '1')").run();
    // Второе соединение к той же базе (WAL допускает параллельных читателей).
    const db2 = openDatabase(dbPath);
    const row = db2.prepare("SELECT value FROM settings WHERE key = 'probe'").get();
    db2.close();
    assert.equal(JSON.parse(row.value), 1);
  } finally {
    await t.close();
  }
});
