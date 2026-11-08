// Клиентский JS Tumbler: переключение форм композера, подтверждение удаления,
// показ NSFW-контента, busy-состояния кнопок, предпросмотр темы блога.
// Без фреймворков и сборщика — нативные ES-модули не нужны, это один файл.
(function () {
  'use strict';

  // Композер: карточка компактна; клик по типу раскрывает форму,
  // повторный клик по активному типу (или «Свернуть») сворачивает обратно.
  const composerCard = document.querySelector('.js-composer-card');
  if (composerCard) {
    const setType = (type) => {
      document.querySelectorAll('.js-composer-type').forEach((b) => {
        const active = b.dataset.type === type;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      document.querySelectorAll('.js-composer-form').forEach((form) => {
        form.hidden = form.dataset.type !== type;
      });
    };
    document.querySelectorAll('.js-composer-type').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wasExpanded = !composerCard.classList.contains('is-compact');
        const wasActive = btn.classList.contains('is-active');
        if (wasExpanded && wasActive) {
          composerCard.classList.add('is-compact');
          composerCard.querySelectorAll('.js-composer-form').forEach((f) => { f.hidden = true; });
          return;
        }
        composerCard.classList.remove('is-compact');
        setType(btn.dataset.type);
      });
    });
    document.querySelectorAll('.js-composer-collapse').forEach((btn) => {
      btn.addEventListener('click', () => {
        composerCard.classList.add('is-compact');
        composerCard.querySelectorAll('.js-composer-form').forEach((f) => { f.hidden = true; });
        document.querySelectorAll('.js-composer-type').forEach((b) => {
          b.classList.remove('is-active');
          b.setAttribute('aria-pressed', 'false');
        });
      });
    });
  }

  // Подтверждение удаления.
  document.querySelectorAll('form.js-confirm').forEach((form) => {
    form.addEventListener('submit', (event) => {
      const message = form.dataset.confirm || 'Вы уверены?';
      if (!window.confirm(message)) event.preventDefault();
    });
  });

  // NSFW: контент не рендерится на сервере; согласие сохраняется в cookie и страница перезагружается.
  document.querySelectorAll('.js-nsfw-reveal').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.cookie = 'tumbler.nsfw=1; path=/; max-age=7776000; samesite=strict';
      window.location.reload();
    });
  });

  // Busy-состояние кнопок отправки: защита от двойной отправки.
  document.querySelectorAll('form').forEach((form) => {
    form.addEventListener('submit', () => {
      // confirm-формы могут отменить отправку — помечаем после фактической отправки нельзя,
      // поэтому ставим busy в task после обработчиков подтверждений.
      setTimeout(() => {
        form.querySelectorAll('button[type="submit"]').forEach((b) => {
          b.disabled = true;
          b.classList.add('is-busy');
        });
      }, 0);
    });
  });

  // Предпросмотр темы блога: собираем текущие значения формы в параметр tp.
  const themeForm = document.querySelector('.js-theme-form');
  const previewBtn = document.querySelector('.js-theme-preview');
  if (themeForm && previewBtn) {
    previewBtn.addEventListener('click', () => {
      const slug = previewBtn.dataset.slug || themeForm.dataset.slug;
      const payload = {
        bgColor: themeForm.querySelector('[name="bg_color"]')?.value,
        accentColor: themeForm.querySelector('[name="accent_color"]')?.value,
        textColor: themeForm.querySelector('[name="text_color"]')?.value,
        font: themeForm.querySelector('[name="font"]')?.value,
      };
      const tp = encodeURIComponent(JSON.stringify(payload));
      window.open('/' + slug + '?tp=' + tp, '_blank');
    });
  }
})();

  // --- Социальные действия (этап 5) ---
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const apiToken = csrfMeta ? csrfMeta.content : null;

  // Лайк: toggle через JSON API, обновление счётчика на месте.
  document.querySelectorAll('.js-like').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy');
      try {
        const res = await fetch('/api/posts/' + btn.dataset.post + '/like', {
          method: 'POST',
          headers: { 'x-csrf-token': apiToken },
        });
        if (!res.ok) return;
        const data = await res.json();
        btn.classList.toggle('is-liked', data.liked);
        const use = btn.querySelector('.js-heart-use');
        if (use) use.setAttribute('href', data.liked ? '#i-heart-fill' : '#i-heart');
        const count = btn.querySelector('.js-like-count');
        if (count) count.textContent = data.likeCount;
      } finally {
        btn.classList.remove('is-busy');
      }
    });
  });

  // Подписка: toggle в тонкой панели блога.
  document.querySelectorAll('.js-follow').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy');
      try {
        const res = await fetch('/api/blogs/' + btn.dataset.slug + '/follow', {
          method: 'POST',
          headers: { 'x-csrf-token': apiToken },
        });
        if (!res.ok) return;
        const data = await res.json();
        btn.classList.toggle('btn-success', data.following);
        btn.classList.toggle('btn-secondary', !data.following);
        btn.textContent = data.following
          ? btn.dataset.labelFollowing
          : btn.dataset.labelFollow;
      } finally {
        btn.classList.remove('is-busy');
      }
    });
  });

  // Форма реблога: разворачивается внутри карточки.
  document.querySelectorAll('.js-reblog-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.post-card');
      const form = card && card.querySelector('.js-reblog-form');
      if (form) form.hidden = !form.hidden;
    });
  });
  document.querySelectorAll('.js-reblog-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = btn.closest('.js-reblog-form');
      if (form) form.hidden = true;
    });
  });

  // Комментарии: показать/скрыть блок.
  document.querySelectorAll('.js-comments-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.post-card');
      const box = card && card.querySelector('.js-comments-box');
      if (box) box.hidden = !box.hidden;
    });
  });
