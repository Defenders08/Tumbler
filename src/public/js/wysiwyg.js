// WYSIWYG-редактор Tumbler («нативный» ввод, Markdown — только внутренний формат).
// Компонент: .js-wysiwyg (contenteditable) + скрытый input[name=...]; на сабмите
// HTML редактора конвертируется в Markdown (turndown) и кладётся в скрытый input.
// Тулбар появляется при выделении текста; emoji-панель — только на ПК.
(function () {
  'use strict';

  var EMOJI = ['😀', '😂', '😍', '🥲', '😎', '🤔', '🙃', '😴', '🤗', '🤩',
    '😭', '😡', '🥳', '😱', '🤯', '🥺', '👍', '👎', '👏', '🙏',
    '❤️', '🔥', '✨', '⭐', '🎉', '💯', '☀️', '🌙', '🌈', '⚡',
    '🐱', '🐶', '🦄', '🐸', '🍕', '☕', '🍺', '🎸', '📷', '💾'];

  var MARKDOWN_TOGGLES = [
    { cmd: 'bold', label: 'B', title: 'Жирный (Ctrl+B)', cls: 'wb-bold' },
    { cmd: 'italic', label: 'I', title: 'Курсив (Ctrl+I)', cls: 'wb-italic' },
    { cmd: 'underline', label: 'U', title: 'Подчёркнутый (Ctrl+U)', cls: 'wb-underline' },
    { cmd: 'strikeThrough', label: 'S', title: 'Зачёркнутый', cls: 'wb-strike' },
    { cmd: 'formatBlock:h2', label: 'H2', title: 'Заголовок' },
    { cmd: 'formatBlock:blockquote', label: '❝', title: 'Цитата' },
    { cmd: 'insertUnorderedList', label: '•—', title: 'Список' },
  ];

  function createToolbar() {
    var bar = document.createElement('div');
    bar.className = 'wysiwyg-toolbar';
    bar.hidden = true;
    MARKDOWN_TOGGLES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-btn ' + (t.cls || '');
      b.title = t.title;
      b.innerHTML = t.label;
      b.dataset.cmd = t.cmd;
      bar.appendChild(b);
    });
    var emojiBtn = document.createElement('button');
    emojiBtn.type = 'button';
    emojiBtn.className = 'wb-btn';
    emojiBtn.title = 'Emoji';
    emojiBtn.textContent = '😀';
    emojiBtn.dataset.emoji = '1';
    bar.appendChild(emojiBtn);

    var emojiPanel = document.createElement('div');
    emojiPanel.className = 'wysiwyg-emoji-panel';
    emojiPanel.hidden = true;
    EMOJI.forEach(function (e) {
      var eb = document.createElement('button');
      eb.type = 'button';
      eb.className = 'we-btn';
      eb.textContent = e;
      emojiPanel.appendChild(eb);
    });
    bar.appendChild(emojiPanel);
    document.body.appendChild(bar);
    return bar;
  }

  function initEditor(textarea) {
    var field = textarea.dataset.field || textarea.name;
    var editor = document.createElement('div');
    editor.className = 'wysiwyg-editor';
    editor.contentEditable = 'true';
    editor.dataset.placeholder = textarea.dataset.placeholder || '';
    // Предзаполнение: сервер отдаёт готовый sanitized HTML в data-html.
    if (textarea.dataset.html) editor.innerHTML = textarea.dataset.html;
    textarea.hidden = true;
    textarea.parentNode.insertBefore(editor, textarea.nextSibling);

    var toolbar = document.querySelector('.wysiwyg-toolbar') || createToolbar();
    var emojiPanel = toolbar.querySelector('.wysiwyg-emoji-panel');
    var activeEditor = null;
    var savedRange = null;

    function sync() {
      var td = new window.TurndownService({ headingStyle: 'atx', emDelimiter: '*' });
      textarea.value = td.turndown(editor.innerHTML);
    }

    function positionToolbar() {
      if (toolbar.hidden || !activeEditor) return;
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      toolbar.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
      toolbar.style.top = Math.max(4, rect.top + window.scrollY - 46) + 'px';
    }

    editor.addEventListener('mouseup', positionToolbar);
    editor.addEventListener('keyup', positionToolbar);
    document.addEventListener('selectionchange', function () {
      var sel = window.getSelection();
      var inEditor = sel.rangeCount && editor.contains(sel.anchorNode);
      if (!inEditor) {
        toolbar.hidden = true;
        emojiPanel.hidden = true;
        return;
      }
      var text = sel.toString();
      if (text.length > 0) {
        toolbar.hidden = false;
        positionToolbar();
      }
    });

    toolbar.addEventListener('mousedown', function (e) {
      // не терять выделение при клике по тулбару
      if (e.target.closest('.wb-btn, .we-btn')) e.preventDefault();
    });
    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('.wb-btn, .we-btn');
      if (!btn) return;
      editor.focus();
      if (savedRange) {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      if (btn.dataset.emoji) {
        emojiPanel.hidden = !emojiPanel.hidden;
        return;
      }
      var cmd = btn.dataset.cmd;
      if (cmd.indexOf('formatBlock:') === 0) {
        var block = cmd.split(':')[1];
        var current = document.queryCommandValue('formatBlock');
        document.execCommand('formatBlock', false, current.toLowerCase() === block ? 'p' : block);
      } else {
        document.execCommand(cmd, false, null);
      }
      sync();
      positionToolbar();
    });
    emojiPanel.addEventListener('click', function (e) {
      var eb = e.target.closest('.we-btn');
      if (!eb) return;
      editor.focus();
      if (savedRange) {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      document.execCommand('insertText', false, eb.textContent);
      emojiPanel.hidden = true;
      sync();
    });
    editor.addEventListener('selectionchange', function () {
      var sel = window.getSelection();
      if (sel.rangeCount) savedRange = sel.getRangeAt(0);
    });

    // Emoji только на ПК (точный указатель)
    if (!window.matchMedia('(pointer: fine)').matches) {
      emojiBtn.style.display = 'none';
    }

    editor.addEventListener('input', sync);
    editor.addEventListener('blur', sync);
    sync();
  }

  document.querySelectorAll('textarea.js-wysiwyg').forEach(initEditor);
})();
