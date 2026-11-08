// Тесты Этапа 6: страницы тегов, поиск (FTS5 + LIKE-фолбэк), Ask box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, createAgent, registerAgent } from './helpers.js';

async function seeded(t) {
  const a = await registerAgent(t.base, { email: 'a@example.com', password: 'parol-1234', slug: 'anna', title: 'Блог Анны' });
  const b = await registerAgent(t.base, { email: 'b@example.com', password: 'parol-1234', slug: 'boris', title: 'Мир Бориса' });
  return { a, b };
}

async function postAs(agent, fields) {
  const res = await agent.postForm('/posts', { action: 'publish', type: 'text', _csrf: agent.csrf, ...fields });
  assert.equal(res.status, 303);
  return Number(res.headers.get('location').match(/created=(\d+)/)?.[1]);
}

test('поиск находит пост по слову, префиксу и русским словоформам', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    await postAs(a.agent, { body: 'Рецепт яблочного пирога с корицей', title: 'Кулинария' });
    await postAs(a.agent, { body: 'Обзор нового смартфона' });

    for (const q of ['пирог', 'пирога', 'ПИРОГ', 'яблочного', 'кулинар']) {
      const res = await a.agent.get('/search?q=' + encodeURIComponent(q));
      assert.match(res.html, /Рецепт яблочного пирога/, `запрос «${q}» должен находить пост`);
    }
    // Пост без совпадений не находится по чужому запросу
    const res = await a.agent.get('/search?q=смартфон');
    assert.match(res.html, /Обзор нового смартфона/);
    assert.doesNotMatch(res.html, /яблочного пирога/);
  } finally {
    await t.close();
  }
});

test('поиск: фильтр по типу поста и пустой результат', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    await postAs(a.agent, { body: 'Заметки о кофе' });
    await a.agent.postForm('/posts/preview', { type: 'text', body: 'x', _csrf: a.agent.csrf }); // не сохраняется
    const res = await a.agent.get('/search?q=кофе&type=quote');
    assert.match(res.html, /Ничего не найдено/);
    const res2 = await a.agent.get('/search?q=кофе');
    assert.match(res2.html, /Заметки о кофе/);
    const empty = await a.agent.get('/search?q=пустышка');
    assert.match(empty.html, /Ничего не найдено/);
  } finally {
    await t.close();
  }
});

test('поиск находит блоги и теги', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await seeded(t);
    await postAs(b.agent, { body: 'что-то про автоспорт', tags: 'автоспорт, гонки' });

    const blogs = await a.agent.get('/search?q=' + encodeURIComponent('мир бориса'));
    assert.match(blogs.html, /Мир Бориса/);

    const tags = await a.agent.get('/search?q=' + encodeURIComponent('авто'));
    assert.match(tags.html, /#автоспорт/);
    assert.match(tags.html, /tag\/автоспорт/);
  } finally {
    await t.close();
  }
});

test('страница тега показывает посты, теги в карточках кликабельны', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    await postAs(a.agent, { body: 'пост про кофе и кофеины', tags: 'кофе, напитки' });
    await postAs(a.agent, { body: 'пост про чай', tags: 'напитки' });

    const guest = await createAgent(t.base);
    const page = await guest.get('/tag/' + encodeURIComponent('кофе'));
    assert.equal(page.res.status, 200);
    assert.match(page.html, /пост про кофе/);
    assert.doesNotMatch(page.html, /пост про чай/);

    // Клик по тегу из карточки ведёт на страницу тега
    const blog = await guest.get('/anna');
    assert.match(blog.html, /href="\/tag\/кофе"/);

    const empty = await guest.get('/tag/несуществующий-тег');
    assert.match(empty.html, /Ничего не найдено/);
  } finally {
    await t.close();
  }
});

test('поиск доступен гостям', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    await postAs(a.agent, { body: 'публичный пост про закат' });
    const guest = await createAgent(t.base);
    const res = await guest.get('/search?q=закат');
    assert.equal(res.res.status, 200);
    assert.match(res.html, /публичный пост про закат/);
  } finally {
    await t.close();
  }
});

// ---------- Ask box ----------

test('ask: отправка вопроса, лимит 500, форма на странице блога', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await seeded(t);
    // Boris включает ask + анонимные вопросы в настройках
    await b.agent.postForm('/settings/blog', {
      _csrf: b.agent.csrf, title: 'Мир Бориса', description: '',
      ask_enabled: 'on', ask_anonymous: 'on',
      bg_color: '#f2f4f7', accent_color: '#2f9dd6', text_color: '#444444', font: 'helvetica',
    });

    const guest = await createAgent(t.base);
    const page = await guest.get('/boris/ask');
    assert.equal(page.res.status, 200);
    assert.match(page.html, /Ваш вопрос/);
    assert.match(page.html, /анонимно/i);

    const sender = await createAgent(t.base);
    await sender.get('/boris/ask');
    const send = await sender.postForm('/boris/ask', {
      _csrf: sender.csrf, question: 'Как выбрать камеру?', anonymous: 'on',
    });
    assert.equal(send.status, 303);
    assert.match(send.headers.get('location'), /sent=1/);

    const asks = t.ctx.db.prepare('SELECT * FROM asks').all();
    assert.equal(asks.length, 1);
    assert.equal(asks[0].is_anonymous, 1);
    assert.equal(asks[0].from_user_id, null);
  } finally {
    await t.close();
  }
});

test('ask: длинный вопрос и выключение ask отклоняют отправку', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await seeded(t);
    // По умолчанию ask включён (как в Tumblr 2012), анонимность выключена.
    const page = await a.agent.get('/boris/ask');
    assert.equal(page.res.status, 200);
    assert.doesNotMatch(page.html, /анонимно/i, 'анонимность по умолчанию выключена');

    const token = page.html.match(/name="_csrf" value="([^"]+)"/)[1];
    const cookie = a.agent.cookieHeader();
    const long = await fetch(`${t.base}/boris/ask`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: token, question: 'в'.repeat(501) }).toString(),
    });
    assert.equal(long.status, 422);
    assert.match(await long.text(), /500 символов/);

    // Владелец выключает ask — страница и отправка закрываются.
    await b.agent.postForm('/settings/blog', {
      _csrf: b.agent.csrf, title: 'Мир Бориса', description: '',
      bg_color: '#f2f4f7', accent_color: '#2f9dd6', text_color: '#444444', font: 'helvetica',
    });
    const closed = await a.agent.get('/boris/ask');
    assert.equal(closed.res.status, 404);
    const post = await fetch(`${t.base}/boris/ask`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: token, question: 'ещё вопрос?' }).toString(),
    });
    assert.equal(post.status, 404);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM asks').get().n, 0);
  } finally {
    await t.close();
  }
});

test('ask: полный цикл — вопрос, входящие, ответ постом', async () => {
  const t = await createTestApp();
  try {
    const { a, b } = await seeded(t);
    await b.agent.postForm('/settings/blog', {
      _csrf: b.agent.csrf, title: 'Мир Бориса', description: '', ask_enabled: 'on',
      bg_color: '#f2f4f7', accent_color: '#2f9dd6', text_color: '#444444', font: 'helvetica',
    });

    // Анна (не анонимно) задаёт вопрос Борису
    const askPage = await a.agent.get('/boris/ask');
    const token = askPage.html.match(/name="_csrf" value="([^"]+)"/)[1];
    const send = await fetch(`${t.base}/boris/ask`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: a.agent.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: token, question: 'Какой у тебя фотоаппарат?' }).toString(),
    });
    assert.equal(send.status, 303);

    // Входящие у Бориса: счётчик и вопрос видны
    const inbox = await b.agent.get('/asks');
    assert.match(inbox.html, /Какой у тебя фотоаппарат/);
    assert.match(inbox.html, /Блог Анны/);

    // Ответ постом
    const askId = t.ctx.db.prepare('SELECT id FROM asks').get().id;
    const answerPage = await b.agent.get(`/asks/${askId}/answer`);
    assert.equal(answerPage.res.status, 200);
    const token2 = answerPage.html.match(/name="_csrf" value="([^"]+)"/)[1];
    const answer = await b.agent.postForm(`/asks/${askId}/answer`, {
      _csrf: token2, body: 'Старая мыльница из 2012-го!',
    });
    assert.equal(answer.status, 303);
    assert.match(answer.headers.get('location'), /\/boris\/\d+/);

    const askRow = t.ctx.db.prepare('SELECT * FROM asks').get();
    assert.equal(askRow.status, 'answered');
    assert.ok(askRow.answer_post_id);

    // Ответ-пост виден в блоге с цитатой вопроса
    const guest = await createAgent(t.base);
    const blog = await guest.get('/boris');
    assert.match(blog.html, /Старая мыльница/);
    assert.match(blog.html, /Какой у тебя фотоаппарат/);

    // Игнорирование и удаление второго вопроса
    const cPage = await a.agent.get('/boris/ask');
    const token3 = cPage.html.match(/name="_csrf" value="([^"]+)"/)[1];
    await fetch(`${t.base}/boris/ask`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: a.agent.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: token3, question: 'Второй вопрос' }).toString(),
    });
    const askId2 = t.ctx.db.prepare("SELECT id FROM asks WHERE status = 'new' AND question = 'Второй вопрос'").get().id;
    const ignored = await b.agent.postForm(`/asks/${askId2}/ignore`, { _csrf: b.agent.csrf });
    assert.equal(ignored.status, 303);
    const deleted = await b.agent.postForm(`/asks/${askId2}/delete`, { _csrf: b.agent.csrf });
    assert.equal(deleted.status, 303);
    assert.equal(t.ctx.db.prepare("SELECT status FROM asks WHERE id = ?").get(askId2).status, 'deleted');
    // Ответленный вопрос остаётся в списке (answered), удалённый — нет
    const inbox2 = await b.agent.get('/asks');
    assert.doesNotMatch(inbox2.html, /Второй вопрос/);
  } finally {
    await t.close();
  }
});

test('ask: только владелец видит входящие', async () => {
  const t = await createTestApp();
  try {
    const { a } = await seeded(t);
    const guest = await createAgent(t.base);
    const res = await guest.get('/asks');
    assert.equal(res.res.status, 302);
  } finally {
    await t.close();
  }
});
