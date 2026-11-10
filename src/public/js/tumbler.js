// Клиентский JS Tumbler: переключение форм композера, подтверждение удаления,
// показ NSFW-контента, busy-состояния кнопок, предпросмотр темы блога.
// Без фреймворков и сборщика — нативные ES-модули не нужны, это один файл.
(function () {
  'use strict';

  // Композер: карточка компактна; клик по типу раскрывает форму,
  // повторный клик по активному типу или клик вне карточки сворачивает обратно.
  const composerCard = document.querySelector('.js-composer-card');
  const composerTypes = Array.from(document.querySelectorAll('.js-composer-type'));
  const composerForms = Array.from(document.querySelectorAll('.js-composer-form'));

  const clearComposerActive = () => {
    composerTypes.forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-pressed', 'false');
    });
  };

  const setComposerType = (type) => {
    composerTypes.forEach((b) => {
      const active = b.dataset.type === type;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    composerForms.forEach((form) => {
      form.hidden = form.dataset.type !== type;
    });
  };

  function hideEmojiPicker() {
    const picker = document.querySelector('.emoji-picker');
    if (!picker) return;
    picker.hidden = true;
    document.querySelectorAll('.js-emoji-toggle[aria-expanded="true"]').forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
    });
  }

  const collapseComposer = () => {
    if (!composerCard) return;
    composerCard.classList.add('is-compact');
    composerForms.forEach((f) => { f.hidden = true; });
    clearComposerActive();
    // В свёрнутом состоянии ни один тип не должен выглядеть/быть в фокусе.
    const active = document.activeElement;
    if (active && composerCard.contains(active) && typeof active.blur === 'function') active.blur();
    const selection = window.getSelection();
    if (selection && typeof selection.removeAllRanges === 'function') selection.removeAllRanges();
    hideEmojiPicker();
  };

  const expandComposer = (type) => {
    if (!composerCard) return;
    composerCard.classList.remove('is-compact');
    setComposerType(type);
  };

  if (composerCard) {
    // При первой отрисовке сервер мог отметить «Текст» активным, хотя форма свёрнута.
    if (composerCard.classList.contains('is-compact')) clearComposerActive();

    composerTypes.forEach((btn) => {
      btn.addEventListener('click', () => {
        const wasExpanded = !composerCard.classList.contains('is-compact');
        const wasActive = btn.classList.contains('is-active');
        if (wasExpanded && wasActive) {
          collapseComposer();
          return;
        }
        expandComposer(btn.dataset.type);
      });
    });

    // Клик вне карточки композера сворачивает открытую форму.
    document.addEventListener('click', (event) => {
      if (composerCard.classList.contains('is-compact')) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (composerCard.contains(target)) return;
      // Тулбар форматирования и панель эмодзи живут вне карточки (в body).
      if (target.closest && (target.closest('.wysiwyg-toolbar') || target.closest('.emoji-picker'))) return;
      collapseComposer();
    });
  }

  // ---------- Смайлпикер ----------

  const EMOJI = ['😀', '😂', '😍', '🥲', '😎', '🤔', '🙃', '😴', '🤗', '🤩',
    '😭', '😡', '🥳', '😱', '🤯', '🥺', '👍', '👎', '👏', '🙏',
    '❤️', '🔥', '✨', '⭐', '🎉', '💯', '☀️', '🌙', '🌈', '⚡',
    '🐱', '🐶', '🦄', '🐸', '🍕', '☕', '🍺', '🎸', '📷', '💾'];

  const emojiPicker = document.createElement('div');
  emojiPicker.className = 'emoji-picker';
  emojiPicker.hidden = true;
  emojiPicker.setAttribute('role', 'dialog');
  EMOJI.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'we-btn';
    btn.textContent = emoji;
    btn.dataset.emoji = emoji;
    btn.setAttribute('aria-label', emoji);
    emojiPicker.appendChild(btn);
  });
  document.body.appendChild(emojiPicker);

  let emojiForm = null;
  let emojiButton = null;

  function positionEmojiPicker() {
    if (!emojiButton || emojiPicker.hidden) return;
    const rect = emojiButton.getBoundingClientRect();
    const width = emojiPicker.offsetWidth;
    const height = emojiPicker.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    emojiPicker.style.left = Math.round(left) + 'px';
    emojiPicker.style.top = Math.round(top) + 'px';
  }

  function insertAtCursor(field, text) {
    if (!field) return;
    field.focus();
    const start = typeof field.selectionStart === 'number' ? field.selectionStart : field.value.length;
    const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : start;
    if (typeof field.setRangeText === 'function') {
      field.setRangeText(text, start, end, 'end');
    } else {
      field.value += text;
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertEmoji(emoji) {
    if (!emojiForm) return;
    const editor = emojiForm.querySelector('.wysiwyg-editor');
    if (editor) {
      // WYSIWYG сам восстановит каретку и синхронизирует Markdown в textarea.
      editor.dispatchEvent(new CustomEvent('wysiwyg:insert', { detail: { text: emoji } }));
      return;
    }
    const field = emojiForm.querySelector('textarea[name="body"], textarea, input[name="title"], input[type="text"]');
    insertAtCursor(field, emoji);
  }

  document.querySelectorAll('.js-emoji-toggle').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const form = btn.closest('form');
      if (emojiForm === form && !emojiPicker.hidden) {
        hideEmojiPicker();
        return;
      }
      emojiForm = form;
      emojiButton = btn;
      emojiPicker.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      positionEmojiPicker();
    });
  });

  emojiPicker.addEventListener('click', (event) => {
    event.stopPropagation();
    const btn = event.target.closest('.we-btn');
    if (!btn) return;
    insertEmoji(btn.dataset.emoji);
    hideEmojiPicker();
  });

  document.addEventListener('click', (event) => {
    if (emojiPicker.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (emojiPicker.contains(target)) return;
    if (target.closest && target.closest('.js-emoji-toggle')) return;
    hideEmojiPicker();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideEmojiPicker();
  });

  window.addEventListener('resize', positionEmojiPicker);
  window.addEventListener('scroll', positionEmojiPicker, { passive: true });

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

  // Живой предпросмотр оттенка: все синие токены в CSS считаются от --tint-shift,
  // поэтому для перекраски страницы достаточно поменять одну переменную.
  const tintRadios = Array.from(document.querySelectorAll('input[name="tint_mode"]'));
  const tintColor = document.querySelector('input[name="tint_color"]');
  if (tintRadios.length) {
    const BASE_HUE = 213;
    const hueFromHex = (hex) => {
      const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
      if (!match) return null;
      const n = Number.parseInt(match[1], 16);
      const r = ((n >> 16) & 255) / 255;
      const g = ((n >> 8) & 255) / 255;
      const b = (n & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (!d) return null;
      let h;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.round((h * 60 + 360) % 360);
    };
    const applyTint = () => {
      const mode = tintRadios.find((radio) => radio.checked)?.value || 'auto';
      let hue = null;
      if (mode === 'custom' && tintColor) hue = hueFromHex(tintColor.value);
      else if (mode === 'auto' && document.body.dataset.bgHue) {
        hue = Number(document.body.dataset.bgHue);
      }
      if (hue == null) {
        document.body.classList.remove('has-blog-tint');
        document.body.style.removeProperty('--tint-shift');
      } else {
        document.body.classList.add('has-blog-tint');
        document.body.style.setProperty('--tint-shift', String(hue - BASE_HUE));
      }
      if (tintColor) tintColor.disabled = mode !== 'custom';
    };
    tintRadios.forEach((radio) => radio.addEventListener('change', applyTint));
    if (tintColor) tintColor.addEventListener('input', applyTint);
    applyTint();
  }
})();

// Соцсети в настройках: добавить/удалить строку без перезагрузки.
const socialList = document.querySelector('.js-social-list');
const socialAdd = document.querySelector('.js-social-add');
if (socialList && socialAdd) {
  const MAX_SOCIALS = 8;
  const socialRows = () => Array.from(socialList.querySelectorAll('.social-row'));
  const syncSocials = () => {
    const count = socialRows().length;
    socialAdd.disabled = count >= MAX_SOCIALS;
    socialRows().forEach((row) => {
      const remove = row.querySelector('.js-social-remove');
      if (remove) remove.style.visibility = count > 1 ? '' : 'hidden';
    });
  };
  socialAdd.addEventListener('click', () => {
    if (socialRows().length >= MAX_SOCIALS) return;
    const last = socialRows().pop();
    if (!last) return;
    const row = last.cloneNode(true);
    row.querySelectorAll('input').forEach((input) => { input.value = ''; });
    const select = row.querySelector('select');
    if (select) select.selectedIndex = 0;
    socialList.appendChild(row);
    syncSocials();
    row.querySelector('input[name="social_url"]')?.focus();
  });
  socialList.addEventListener('click', (event) => {
    const remove = event.target.closest('.js-social-remove');
    if (!remove) return;
    const row = remove.closest('.social-row');
    if (!row) return;
    if (socialRows().length > 1) row.remove();
    else row.querySelectorAll('input').forEach((input) => { input.value = ''; });
    syncSocials();
  });
  syncSocials();
}

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
        const counter = btn.closest('.blog-stats')?.querySelector('.js-followers-count');
        if (counter && Number.isFinite(data.followerCount)) counter.textContent = String(data.followerCount);
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

  // --- Комментарии 2.0: лайки и ответы ---
  document.querySelectorAll('.js-comment-like').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy');
      try {
        const res = await fetch('/api/comments/' + btn.dataset.comment + '/like', {
          method: 'POST',
          headers: { 'x-csrf-token': apiToken },
        });
        if (!res.ok) return;
        const data = await res.json();
        btn.classList.toggle('is-liked', data.liked);
        const use = btn.querySelector('.js-comment-heart');
        if (use) use.setAttribute('href', data.liked ? '#i-heart-fill' : '#i-heart');
        const count = btn.querySelector('.js-like-count');
        if (count) count.textContent = data.likeCount;
      } finally {
        btn.classList.remove('is-busy');
      }
    });
  });

  // Ответ на комментарий: parent_id + подсказка «→ Автор», отмена возвращает обычный режим.
  document.querySelectorAll('.js-reply').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.comments-box');
      const form = card && card.querySelector('.js-comment-form');
      if (!form) return;
      form.querySelector('.js-parent-id').value = btn.dataset.comment;
      const hint = document.createElement('span');
      hint.className = 'reply-hint';
      hint.textContent = '→ ' + (btn.dataset.author || '');
      form.querySelector('input[type="text"]').placeholder = hint.textContent;
      const cancel = form.querySelector('.js-reply-cancel');
      cancel.hidden = false;
      cancel.onclick = () => {
        form.querySelector('.js-parent-id').value = '';
        form.querySelector('input[type="text"]').placeholder = form.querySelector('input[type="text"]').dataset.placeholder || 'Ваш комментарий…';
        cancel.hidden = true;
      };
      const input = form.querySelector('input[type="text"]');
      input.dataset.placeholder = input.dataset.placeholder || input.placeholder;
      input.placeholder = '→ ' + (btn.dataset.author || '') + ': ваш ответ…';
      input.focus();
    });
  });

  // ---------- Drag & drop загрузки файлов ----------
  // Любой input[type=file] превращается в дропзону: клик по области, перетаскивание,
  // список выбранного с миниатюрами и удалением. Без JS остаётся обычный input.
  (function setupDropzones() {
    const stringsEl = document.querySelector('.js-dz-strings');
    const d = (stringsEl && stringsEl.dataset) || {};
    const STRINGS = {
      titleOne: d.titleOne || 'Перетащите файл сюда',
      titleMany: d.titleMany || 'Перетащите файлы сюда',
      sub: d.sub || 'или выберите на диске',
      over: d.over || 'Отпустите, чтобы загрузить',
      replaceOne: d.replaceOne || 'Файл выбран — нажмите, чтобы заменить',
      addMany: d.addMany || 'Нажмите, чтобы добавить ещё',
      remove: d.remove || 'Убрать файл',
      badType: d.badType || 'Этот файл не подходит по типу.',
      limit: d.limit || 'Можно не больше {max} файлов.',
    };
    const isEn = String(document.documentElement.lang || '').toLowerCase().startsWith('en');

    const iconFor = (accept) => {
      const a = String(accept || '').toLowerCase();
      if (a.includes('video/')) return 'i-video';
      if (a.includes('audio/')) return 'i-audio';
      if (a.includes('image/gif') && !a.includes('image/jpeg')) return 'i-gif';
      return 'i-photo';
    };

    const matchesAccept = (file, accept) => {
      const rules = String(accept || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
      if (!rules.length) return true;
      const name = String(file.name || '').toLowerCase();
      const type = String(file.type || '').toLowerCase();
      return rules.some((rule) => {
        if (rule.charAt(0) === '.') return name.endsWith(rule);
        if (rule.slice(-1) === '*') return type.startsWith(rule.slice(0, -1));
        return type === rule;
      });
    };

    const formatSize = (bytes) => {
      if (!bytes) return '';
      if (bytes >= 1048576) {
        const value = (bytes / 1048576).toFixed(1);
        return (isEn ? value : value.replace('.', ',')) + (isEn ? ' MB' : ' МБ');
      }
      if (bytes >= 1024) return Math.round(bytes / 1024) + (isEn ? ' KB' : ' КБ');
      return bytes + (isEn ? ' B' : ' Б');
    };

    const extOf = (name) => {
      const parts = String(name || '').split('.');
      return parts.length > 1 ? parts.pop().slice(0, 4).toUpperCase() : 'FILE';
    };

    const enhance = (input) => {
      if (!input || input.dataset.dropzone === 'on') return;
      input.dataset.dropzone = 'on';
      const multiple = Boolean(input.multiple);
      const max = parseInt(input.dataset.max || '0', 10) || 0;

      const zone = document.createElement('div');
      zone.className = 'dropzone';
      zone.innerHTML =
        '<svg class="icon dropzone-icon" aria-hidden="true"><use href="#' + iconFor(input.accept) + '"></use></svg>' +
        '<span class="dropzone-title" aria-hidden="true"></span>' +
        '<span class="dropzone-sub" aria-hidden="true"></span>';
      const title = zone.querySelector('.dropzone-title');
      const sub = zone.querySelector('.dropzone-sub');

      // Тип может задать свою подпись плитки (например, форматы медиа у фото-поста).
      const idleTitle = input.dataset.dropTitle || (multiple ? STRINGS.titleMany : STRINGS.titleOne);
      const idleSub = input.dataset.dropSub || STRINGS.sub;
      const addText = input.dataset.dropAdd || STRINGS.addMany;
      const replaceText = input.dataset.dropReplace || STRINGS.replaceOne;
      sub.textContent = idleSub;

      input.parentNode.insertBefore(zone, input);
      zone.appendChild(input);

      const tilesMode = input.dataset.dropLayout === 'tiles';
      let tiles = null;
      if (tilesMode) {
        zone.classList.add('is-tiles');
        tiles = document.createElement('div');
        tiles.className = 'dz-tiles';
        tiles.hidden = true;
        zone.insertBefore(tiles, input);
      }

      const list = document.createElement('div');
      list.className = 'dropzone-files';
      list.hidden = true;
      const note = document.createElement('p');
      note.className = 'dropzone-note';
      note.hidden = true;
      zone.insertAdjacentElement('afterend', list);
      list.insertAdjacentElement('afterend', note);

      let previews = [];
      let noteTimer = 0;
      let dragDepth = 0;

      const showNote = (text) => {
        note.textContent = text;
        note.hidden = false;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => { note.hidden = true; }, 6000);
      };

      const updateText = () => {
        const count = (input.files || []).length;
        if (dragDepth) {
          title.textContent = STRINGS.over;
        } else if (count) {
          title.textContent = multiple ? addText : replaceText;
        } else {
          title.textContent = idleTitle;
        }
        sub.style.display = count ? 'none' : '';
      };

      const removeAt = (index) => {
        const data = new DataTransfer();
        Array.from(input.files || []).forEach((file, i) => {
          if (i !== index) data.items.add(file);
        });
        input.files = data.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const render = () => {
        previews.forEach((url) => URL.revokeObjectURL(url));
        previews = [];
        const files = Array.from(input.files || []);
        zone.classList.toggle('has-files', files.length > 0);
        updateText();

        if (tilesMode) {
          list.hidden = true;
          tiles.textContent = '';
          tiles.hidden = files.length === 0;
          tiles.dataset.count = String(files.length);
          files.forEach((file, index) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'dz-tile';
            tile.title = file.name;
            tile.setAttribute('aria-label', file.name);

            if (String(file.type || '').startsWith('image/')) {
              const url = URL.createObjectURL(file);
              previews.push(url);
              const img = document.createElement('img');
              img.src = url;
              img.alt = '';
              tile.appendChild(img);
            } else {
              const fallback = document.createElement('span');
              fallback.className = 'dz-tile-fallback';
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              svg.setAttribute('class', 'icon');
              const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
              use.setAttribute('href', '#' + iconFor(input.accept));
              svg.appendChild(use);
              const ext = document.createElement('span');
              ext.className = 'dz-tile-ext';
              ext.textContent = extOf(file.name);
              fallback.append(svg, ext);
              tile.appendChild(fallback);
            }

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'dz-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', STRINGS.remove + ': ' + file.name);
            remove.addEventListener('click', (event) => {
              event.stopPropagation();
              removeAt(index);
            });
            tile.appendChild(remove);

            tile.addEventListener('click', () => input.click());
            tiles.appendChild(tile);
          });
          return;
        }

        list.textContent = '';
        list.hidden = files.length === 0;

        files.forEach((file, index) => {
          const chip = document.createElement('span');
          chip.className = 'dz-file';

          const thumb = document.createElement('span');
          thumb.className = 'dz-thumb';
          if (String(file.type || '').startsWith('image/')) {
            const url = URL.createObjectURL(file);
            previews.push(url);
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            thumb.appendChild(img);
          } else {
            thumb.textContent = extOf(file.name);
          }

          const name = document.createElement('span');
          name.className = 'dz-name';
          name.textContent = file.name;
          name.title = file.name;

          const size = document.createElement('span');
          size.className = 'dz-size';
          size.textContent = formatSize(file.size);

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'dz-remove';
          remove.textContent = '×';
          remove.setAttribute('aria-label', STRINGS.remove + ': ' + file.name);
          remove.addEventListener('click', () => removeAt(index));

          chip.append(thumb, name, size, remove);
          list.appendChild(chip);
        });
      };

      const acceptFiles = (incoming) => {
        if (!incoming.length) return;
        const current = Array.from(input.files || []);
        const seen = new Set(current.map((f) => f.name + ':' + f.size + ':' + f.lastModified));
        const good = [];
        let rejected = 0;

        incoming.forEach((file) => {
          if (!matchesAccept(file, input.accept)) {
            rejected += 1;
            return;
          }
          const key = file.name + ':' + file.size + ':' + file.lastModified;
          if (seen.has(key)) return;
          seen.add(key);
          good.push(file);
        });

        let next;
        if (multiple) next = current.concat(good);
        else next = good.length ? [good[0]] : current;

        let warning = '';
        if (max && next.length > max) {
          next = next.slice(0, max);
          warning = STRINGS.limit.replace('{max}', String(max));
        } else if (rejected) {
          warning = STRINGS.badType;
        }

        if (!next.length) {
          if (warning) showNote(warning);
          return;
        }
        const data = new DataTransfer();
        next.forEach((file) => data.items.add(file));
        input.files = data.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (warning) showNote(warning);
      };

      const hasFiles = (event) => {
        const types = event.dataTransfer && event.dataTransfer.types;
        return Boolean(types && Array.from(types).indexOf('Files') !== -1);
      };

      zone.addEventListener('dragenter', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth += 1;
        zone.classList.add('is-dragover');
        updateText();
      });

      zone.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      });

      zone.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) {
          zone.classList.remove('is-dragover');
          updateText();
        }
      });

      zone.addEventListener('drop', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth = 0;
        zone.classList.remove('is-dragover');
        acceptFiles(Array.from(event.dataTransfer.files || []));
        updateText();
      });

      input.addEventListener('change', () => {
        note.hidden = true;
        render();
      });

      render();
    };

    document.querySelectorAll('input[type="file"]').forEach(enhance);
  })();
