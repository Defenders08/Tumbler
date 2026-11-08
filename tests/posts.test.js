// Тесты постов: все семь типов сквозняком (создание -> отображение), черновики,
// редактирование, удаление, валидация медиа, NSFW, права.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent, makePng, makeJpeg, makeAnimatedGif, makeStaticGif, makeMp3, makeMp4, makeExe } from './helpers.js';
import { setSetting } from '../src/db/settings.js';

async function setupUser(t, slug = 'marta') {
  return registerAgent(t.base, { email: `${slug}@example.com`, password: 'parol-1234', slug, title: `Блог ${slug}` });
}

test('текстовый пост: создание, markdown, отображение в ленте и блоге', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await agent.postForm('/posts', {
      action: 'publish', type: 'text', title: 'Первый', body: 'Привет, **мир**!',
      tags: 'тест, Первый', _csrf: agent.csrf,
    });
    assert.equal(res.status, 303);

    const dash = await agent.get('/dashboard');
    assert.match(dash.html, /<strong>мир<\/strong>/);
    assert.match(dash.html, /#тест/);
    assert.match(dash.html, /#первый/, 'теги нормализуются к нижнему регистру');

    // Санитизация: HTML в тексте экранируется
    await agent.postForm('/posts', {
      action: 'publish', type: 'text', body: '<script>alert(1)</script>Обычный *текст*', _csrf: agent.csrf,
    });
    const page = await agent.get('/dashboard');
    assert.doesNotMatch(page.html, /<script>/);
    assert.match(page.html, /&lt;script&gt;/);
    assert.match(page.html, /<em>текст<\/em>/, 'markdown-разметка разрешена');
  } finally {
    await t.close();
  }
});

test('фото-пост: PNG сохраняется и отображается, /media отдаёт файл', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const png = await makePng();
    const res = await agent.postMultipart('/posts', {
      action: 'publish', type: 'photo', body: 'моя фотка', _csrf: agent.csrf,
    }, [{ field: 'media', data: png, mime: 'image/png', name: 'photo.png' }]);
    assert.equal(res.status, 303);

    const blog = await agent.get('/marta');
    const keyMatch = blog.html.match(/\/media\/([0-9a-f]{32})/);
    assert.ok(keyMatch, 'ссылка на /media есть');

    const media = await fetch(`${t.base}/media/${keyMatch[1]}`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.equal(media.headers.get('x-content-type-options'), 'nosniff');
    const stored = Buffer.from(await media.arrayBuffer());
    assert.ok(stored.length > 0);

    const row = t.ctx.db.prepare('SELECT * FROM media').get();
    assert.equal(row.kind, 'image');
    assert.ok(row.width >= 1 && row.height >= 1);
  } finally {
    await t.close();
  }
});

test('фото-пост: анимированный GIF отклоняется — нужен отдельный тип GIF', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const gif = makeAnimatedGif();
    const res = await agent.postMultipart('/posts', {
      action: 'publish', type: 'photo', _csrf: agent.csrf,
    }, [{ field: 'media', data: gif, mime: 'image/gif', name: 'anim.gif' }]);
    assert.equal(res.status, 422);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const count = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
    assert.equal(count, 0, 'пост не сохранён');
  } finally {
    await t.close();
  }
});

test('GIF-пост: анимированный GIF проходит, статичный GIF и PNG отклоняются', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);

    const ok = await agent.postMultipart('/posts', {
      action: 'publish', type: 'gif', body: 'анимация', _csrf: agent.csrf,
    }, [{ field: 'file', data: makeAnimatedGif(), mime: 'image/gif', name: 'anim.gif' }]);
    assert.equal(ok.status, 303);

    const blog = await agent.get('/marta');
    assert.match(blog.html, /gif-badge/);

    const staticGif = await agent.postMultipart('/posts', {
      action: 'publish', type: 'gif', _csrf: agent.csrf,
    }, [{ field: 'file', data: await makeStaticGif(), mime: 'image/gif', name: 'static.gif' }]);
    assert.equal(staticGif.status, 422);

    const png = await agent.postMultipart('/posts', {
      action: 'publish', type: 'gif', _csrf: agent.csrf,
    }, [{ field: 'file', data: await makePng(), mime: 'image/png', name: 'x.png' }]);
    assert.equal(png.status, 422);
  } finally {
    await t.close();
  }
});

test('файл .exe с именем .gif отклоняется по содержимому', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await agent.postMultipart('/posts', {
      action: 'publish', type: 'gif', _csrf: agent.csrf,
    }, [{ field: 'file', data: makeExe(), mime: 'image/gif', name: 'virus.gif' }]);
    assert.equal(res.status, 422);
    const keys = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
    assert.equal(keys, 0, 'ни один файл не сохранён');
  } finally {
    await t.close();
  }
});

test('цитата: текст и источник', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await agent.postForm('/posts', {
      action: 'publish', type: 'quote', quote: 'Всё гениальное просто', source: 'Народная мудрость', _csrf: agent.csrf,
    });
    assert.equal(res.status, 303);
    const blog = await agent.get('/marta');
    assert.match(blog.html, /Всё гениальное просто/);
    assert.match(blog.html, /Народная мудрость/);

    const empty = await agent.postForm('/posts', { action: 'publish', type: 'quote', quote: '', _csrf: agent.csrf });
    assert.equal(empty.status, 422);
  } finally {
    await t.close();
  }
});

test('ссылка: валидный URL создаёт карточку, javascript: отклоняется', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const ok = await agent.postForm('/posts', {
      action: 'publish', type: 'link',
      url: 'https://example.com/статья',
      title: 'Интересная статья',
      description: 'Читал в 2012 — до сих пор актуально.',
      _csrf: agent.csrf,
    });
    assert.equal(ok.status, 303);
    const blog = await agent.get('/marta');
    assert.match(blog.html, /Интересная статья/);
    assert.match(blog.html, /link-card/);
    assert.match(blog.html, /https:\/\/example\.com/);

    const bad = await agent.postForm('/posts', {
      action: 'publish', type: 'link', url: 'javascript:alert(1)', _csrf: agent.csrf,
    });
    assert.equal(bad.status, 422);
  } finally {
    await t.close();
  }
});

test('аудио-пост: mp3 сохраняется и отдаётся с правильным типом', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await agent.postMultipart('/posts', {
      action: 'publish', type: 'audio', title: 'Трек 2012', _csrf: agent.csrf,
    }, [{ field: 'file', data: makeMp3(), mime: 'audio/mpeg', name: 'song.mp3' }]);
    assert.equal(res.status, 303);
    const blog = await agent.get('/marta');
    assert.match(blog.html, /<audio /);
    assert.match(blog.html, /Трек 2012/);

    const key = blog.html.match(/audio[^>]*src="\/media\/([0-9a-f]{32})"/)?.[1];
    assert.ok(key, 'ключ аудио найден');
    const media = await fetch(`${t.base}/media/${key}`);
    assert.equal(media.headers.get('content-type'), 'audio/mpeg');
  } finally {
    await t.close();
  }
});

test('видео-пост: mp4 сохраняется и отображается плеером', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await agent.postMultipart('/posts', {
      action: 'publish', type: 'video', title: 'Клип', _csrf: agent.csrf,
    }, [{ field: 'file', data: makeMp4(), mime: 'video/mp4', name: 'clip.mp4' }]);
    assert.equal(res.status, 303);
    const blog = await agent.get('/marta');
    assert.match(blog.html, /<video /);
  } finally {
    await t.close();
  }
});

test('лимит размера изображения применяется из настроек', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    setSetting(t.ctx.db, 'upload_limits', { image: 50, gif: 10_000_000, audio: 10_000_000, video: 10_000_000, maxFilesPerPost: 2 });
    const res = await agent.postMultipart('/posts', {
      action: 'publish', type: 'photo', _csrf: agent.csrf,
    }, [{ field: 'media', data: await makePng(), mime: 'image/png', name: 'big.png' }]);
    assert.equal(res.status, 422);
  } finally {
    await t.close();
  }
});

test('черновик: не виден гостям, публикуется через редактирование', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await agent.postForm('/posts', {
      action: 'draft', type: 'text', title: 'Черновик', body: 'черновой текст', _csrf: agent.csrf,
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location') ?? '', /\/drafts/);

    const guest = await createAgent(t.base);
    const guestBlog = await guest.get('/marta');
    assert.doesNotMatch(guestBlog.html, /черновой текст/);

    const draftsPage = await agent.get('/drafts');
    assert.match(draftsPage.html, /черновой текст/);

    const draftId = t.ctx.db.prepare("SELECT id FROM posts WHERE status = 'draft'").get().id;

    // Пермалинк черновика: гость — 404, владелец видит
    const guestPermalink = await guest.get('/marta/' + draftId);
    assert.equal(guestPermalink.res.status, 404);
    const ownerPermalink = await agent.get('/marta/' + draftId);
    assert.equal(ownerPermalink.res.status, 200);

    const publish = await agent.postForm(`/posts/${draftId}/edit`, {
      action: 'publish', type: 'text', title: 'Черновик', body: 'черновой текст', _csrf: agent.csrf,
    });
    assert.equal(publish.status, 303);
    const status = t.ctx.db.prepare('SELECT status FROM posts WHERE id = ?').get(draftId).status;
    assert.equal(status, 'published');
  } finally {
    await t.close();
  }
});

test('редактирование: заголовок и теги обновляются', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    await agent.postForm('/posts', {
      action: 'publish', type: 'text', title: 'Старое', body: 'текст', tags: 'старый', _csrf: agent.csrf,
    });
    const id = t.ctx.db.prepare("SELECT id FROM posts").get().id;
    const res = await agent.postForm(`/posts/${id}/edit`, {
      action: 'save', type: 'text', title: 'Новое', body: 'текст обновлён', tags: 'новый, чистый', _csrf: agent.csrf,
    });
    assert.equal(res.status, 303);
    const post = t.ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    assert.equal(post.title, 'Новое');
    const blog = await agent.get('/marta');
    assert.match(blog.html, /Новое/);
    assert.match(blog.html, /#новый/);
    assert.doesNotMatch(blog.html, /#старый/);
  } finally {
    await t.close();
  }
});

test('чужой пост нельзя редактировать или удалить', async () => {
  const t = await createTestApp();
  try {
    const a = await setupUser(t, 'marta');
    const b = await setupUser(t, 'fedor');
    await a.agent.postForm('/posts', { action: 'publish', type: 'text', body: 'пост Марта', _csrf: a.agent.csrf });
    const id = t.ctx.db.prepare("SELECT id FROM posts").get().id;

    const edit = await b.agent.postForm(`/posts/${id}/edit`, {
      action: 'save', type: 'text', body: 'взломано', _csrf: b.agent.csrf,
    });
    assert.equal(edit.status, 404);
    const del = await b.agent.postForm(`/posts/${id}/delete`, { _csrf: b.agent.csrf });
    assert.equal(del.status, 404);
    const body = t.ctx.db.prepare('SELECT body FROM posts WHERE id = ?').get(id).body;
    assert.equal(body, 'пост Марта');
  } finally {
    await t.close();
  }
});

test('удаление: пост исчезает из блога и ленты, но остаётся в базе (мягкое)', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    await agent.postForm('/posts', { action: 'publish', type: 'text', body: 'на удаление', _csrf: agent.csrf });
    const id = t.ctx.db.prepare("SELECT id FROM posts").get().id;
    const del = await agent.postForm(`/posts/${id}/delete`, { _csrf: agent.csrf });
    assert.equal(del.status, 303);

    const guest = await createAgent(t.base);
    const blog = await guest.get('/marta');
    assert.doesNotMatch(blog.html, /на удаление/);
    const permalink = await guest.get(`/marta/${id}`);
    assert.equal(permalink.res.status, 404);
    const row = t.ctx.db.prepare('SELECT status FROM posts WHERE id = ?').get(id);
    assert.equal(row.status, 'deleted');
  } finally {
    await t.close();
  }
});

test('NSFW: гость видит занавес, владелец — контент', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    await agent.postForm('/posts', {
      action: 'publish', type: 'text', body: 'секретные подробности', nsfw: 'on', _csrf: agent.csrf,
    });
    const guest = await createAgent(t.base);
    const guestBlog = await guest.get('/marta');
    assert.match(guestBlog.html, /nsfw-placeholder/);
    assert.doesNotMatch(guestBlog.html, /секретные подробности/, 'тело поста скрыто занавесом');

    // Гость, согласившийся на 18+ (cookie), видит контент
    const guestOk = await createAgent(t.base);
    guestOk.jar.set('tumbler.nsfw', '1');
    const guestOkBlog = await guestOk.get('/marta');
    assert.match(guestOkBlog.html, /секретные подробности/);

    const ownerBlog = await agent.get('/marta');
    assert.doesNotMatch(ownerBlog.html, /nsfw-placeholder/);
    assert.match(ownerBlog.html, /секретные подробности/);
  } finally {
    await t.close();
  }
});

test('предпросмотр рендерит markdown без сохранения', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await agent.postForm('/posts/preview', {
      type: 'text', title: 'Превью', body: '**жирный**', _csrf: agent.csrf,
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<strong>жирный<\/strong>/);
    const count = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
    assert.equal(count, 0);
  } finally {
    await t.close();
  }
});

test('создание поста без CSRF-токена отклоняется', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    const res = await fetch(`${t.base}/posts`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: agent.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'type=text&action=publish&body=x',
    });
    assert.equal(res.status, 403);
  } finally {
    await t.close();
  }
});

test('многостраничная лента: пагинация без дублей и с хронологией', async () => {
  const t = await createTestApp();
  try {
    const { agent } = await setupUser(t);
    for (let i = 1; i <= 12; i++) {
      await agent.postForm('/posts', {
        action: 'publish', type: 'text', body: `пост номер ${i}`, _csrf: agent.csrf,
      });
    }
    const page1 = await agent.get('/dashboard');
    const page2 = await agent.get('/dashboard?page=2');
    const ids1 = [...page1.html.matchAll(/id="post-(\d+)"/g)].map((m) => Number(m[1]));
    const ids2 = [...page2.html.matchAll(/id="post-(\d+)"/g)].map((m) => Number(m[1]));
    assert.equal(ids1.length, 10);
    assert.equal(ids2.length, 2);
    assert.deepEqual([...ids1, ...ids2].sort((a, b) => b - a), ids1.concat(ids2), 'страницы не пересекаются');
    // Хронология: новые выше старых
    assert.ok(ids1[0] > ids1[ids1.length - 1]);
  } finally {
    await t.close();
  }
});
