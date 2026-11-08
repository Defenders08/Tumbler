// Помощники тестов: изолированное приложение на временном каталоге,
// агенты с cookie/CSRF, синтетические медиа-фикстуры.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createLocalStorage } from '../src/modules/media/storage.js';
import { seedAdmin } from '../src/modules/auth/service.js';

const silentLog = { info: () => {}, warn: () => {}, error: (...a) => console.error('[server]', ...a) };

export async function createTestApp({ admin } = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tumbler-test-'));
  const config = {
    env: 'test',
    isProduction: false,
    port: 0,
    dataDir: tmp,
    dbPath: path.join(tmp, 'test.db'),
    uploadsDir: path.join(tmp, 'uploads'),
    uploadsTmpDir: path.join(tmp, 'uploads-tmp'),
    sessionSecret: 'test-secret-'.repeat(6),
    sessionTtlDays: 30,
    adminEmail: admin?.email ?? null,
    adminPassword: admin?.password ?? null,
    defaultLocale: 'ru',
  };
  const db = openDatabase(config.dbPath);
  migrate(db);
  const ctx = { config, db, log: silentLog, storage: createLocalStorage(config.uploadsDir) };
  if (admin) await seedAdmin(ctx, config, silentLog);
  const app = createApp(ctx);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ctx,
    base,
    tmp,
    close: async ({ keepFiles = false } = {}) => {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      if (!keepFiles) await fs.rm(tmp, { recursive: true, force: true });
    },
  };
}

// ---------- Cookie/CSRF агенты ----------

function collectCookies(jar, res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const [name, value] = pair.split('=');
    jar.set(name.trim(), value.trim());
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function extractCsrf(html) {
  const m = html.match(/csrf-token" content="([^"]+)"/);
  if (!m) throw new Error('CSRF-токен не найден в разметке');
  return m[1];
}

// Агент — один браузер: jar cookie + актуальный CSRF-токен.
export async function createAgent(base) {
  const jar = new Map();
  let csrf = null;
  const agent = {
    jar,
    get csrf() {
      return csrf;
    },
    cookieHeader: () => cookieHeader(jar),
    async get(pathname) {
      const res = await fetch(base + pathname, {
        redirect: 'manual',
        headers: { cookie: cookieHeader(jar) },
      });
      collectCookies(jar, res);
      const html = await res.text();
      try {
        csrf = extractCsrf(html);
      } catch {
        // не HTML-страница — токен не требуется
      }
      return { res, html };
    },
    async postForm(pathname, fields) {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) body.set(key, String(value));
      }
      const res = await fetch(base + pathname, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieHeader(jar), 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      collectCookies(jar, res);
      return res;
    },
    async postMultipart(pathname, fields, files) {
      const fd = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) fd.set(key, String(value));
      }
      for (const f of files ?? []) {
        fd.append(f.field, new Blob([f.data], { type: f.mime }), f.name ?? 'file');
      }
      const res = await fetch(base + pathname, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieHeader(jar) },
        body: fd,
      });
      collectCookies(jar, res);
      return res;
    },
  };
  return agent;
}

export async function registerAgent(base, data) {
  const agent = await createAgent(base);
  await agent.get('/register');
  const res = await agent.postForm('/register', {
    _csrf: agent.csrf,
    email: data.email,
    password: data.password,
    slug: data.slug,
    title: data.title ?? data.slug,
    locale: data.locale ?? 'ru',
  });
  // После входа токен привязан к user.id — обновляем с любой страницы.
  await agent.get('/dashboard');
  return { agent, status: res.status, location: res.headers.get('location') };
}

// ---------- Фикстуры ----------

export async function makePng() {
  const { default: sharp } = await import('sharp');
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#dd4b39' } }).png().toBuffer();
}

export async function makeJpeg() {
  const { default: sharp } = await import('sharp');
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#2f9dd6' } }).jpeg().toBuffer();
}

export function makeAnimatedGif(colors = [[255, 0, 0], [0, 0, 255]]) {
  const bytes = [];
  const push = (...b) => bytes.push(...b);
  const ascii = (s) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
  };
  ascii('GIF89a');
  push(0x02, 0x00, 0x02, 0x00);
  push(0x80, 0x00, 0x00);
  push(...colors[0], ...colors[1]);
  push(0x21, 0xff, 0x0b);
  ascii('NETSCAPE2.0');
  push(0x03, 0x01, 0x00, 0x00, 0x00);
  for (const pix of [[0, 0, 1, 1], [1, 1, 0, 0]]) {
    push(0x21, 0xf9, 0x04, 0x04, 0x05, 0x00, 0x00, 0x00);
    push(0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00);
    push(0x02);
    const codes = [4];
    for (const p of pix) codes.push(4, p);
    codes.push(5);
    let acc = 0;
    let nbits = 0;
    const data = [];
    for (const c of codes) {
      acc |= c << nbits;
      nbits += 3;
      while (nbits >= 8) {
        data.push(acc & 0xff);
        acc >>= 8;
        nbits -= 8;
      }
    }
    if (nbits > 0) data.push(acc & 0xff);
    push(data.length, ...data, 0x00);
  }
  push(0x3b);
  return Buffer.from(bytes);
}

export async function makeStaticGif() {
  const { default: sharp } = await import('sharp');
  const png = await makePng();
  return sharp(png).gif().toBuffer();
}

export function makeMp3() {
  const header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x7f, 0x64]);
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([header, Buffer.alloc(100), frame, Buffer.alloc(200)]);
}

export function makeMp4() {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.from([0, 0, 0x02, 0]),
    Buffer.from('isomiso2', 'ascii'),
    Buffer.alloc(300),
  ]);
}

export function makeExe() {
  return Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(200)]);
}
