// WYSIWYG-редактор Tumbler («нативный» ввод, Markdown — только внутренний формат).
// Компонент: .js-wysiwyg (contenteditable) + скрытый input[name=...]; на сабмите
// HTML редактора конвертируется в Markdown (turndown) и кладётся в скрытый input.
// Панель форматирования появляется при выделении текста; смайлпикер — отдельная
// кнопка в футере композера (см. tumbler.js).
(function () {
  'use strict';

  var MARKDOWN_TOGGLES = [
    { cmd: 'bold', label: 'B', title: 'Жирный (Ctrl+B)', cls: 'wb-bold' },
    { cmd: 'italic', label: 'I', title: 'Курсив (Ctrl+I)', cls: 'wb-italic' },
    { cmd: 'underline', label: 'U', title: 'Подчёркнутый (Ctrl+U)', cls: 'wb-underline' },
    { cmd: 'strikeThrough', label: 'S', title: 'Зачёркнутый', cls: 'wb-strike' },
    { cmd: 'formatBlock:h2', label: 'H2', title: 'Заголовок' },
    { cmd: 'formatBlock:blockquote', label: '❝', title: 'Цитата' },
    { cmd: 'insertUnorderedList', label: '•—', title: 'Список' },
  ];

  var toolbar = createToolbar();
  var activeEditor = null;
  var savedRange = null;
  var syncers = new WeakMap();

  function createToolbar() {
    var bar = document.createElement('div');
    bar.className = 'wysiwyg-toolbar';
    bar.hidden = true;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Форматирование');
    MARKDOWN_TOGGLES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-btn ' + (t.cls || '');
      b.title = t.title;
      b.textContent = t.label;
      b.dataset.cmd = t.cmd;
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
    return bar;
  }

  function closestEditor(node) {
    if (!node) return null;
    var el = node.nodeType === 1 ? node : node.parentElement;
    return el && el.closest ? el.closest('.wysiwyg-editor') : null;
  }

  function hideToolbar() {
    toolbar.hidden = true;
  }

  function saveRange() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
  }

  function restoreRange(editor) {
    if (!savedRange) return false;
    var node = savedRange.commonAncestorContainer;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || !editor.contains(el)) return false;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  }

  function positionToolbar() {
    if (!activeEditor) return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    if ((!rect || (rect.width === 0 && rect.height === 0))) {
      rect = activeEditor.getBoundingClientRect();
    }
    var width = toolbar.offsetWidth || 280;
    var height = toolbar.offsetHeight || 34;
    var left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    var top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    toolbar.style.left = Math.round(left) + 'px';
    toolbar.style.top = Math.round(top) + 'px';
  }

  function syncEditor(editor) {
    var sync = syncers.get(editor);
    if (sync) sync();
  }

  function insertText(editor, text) {
    editor.focus();
    if (!restoreRange(editor)) {
      var range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('insertText', false, text);
    saveRange();
    syncEditor(editor);
  }

  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      activeEditor = null;
      hideToolbar();
      return;
    }
    var editor = closestEditor(sel.anchorNode);
    if (!editor) {
      activeEditor = null;
      hideToolbar();
      return;
    }
    activeEditor = editor;
    saveRange();
    // Редактор нужен только при непустом выделении.
    if (sel.toString().length > 0) {
      toolbar.hidden = false;
      positionToolbar();
    } else {
      hideToolbar();
    }
  });

  window.addEventListener('scroll', function () {
    if (!toolbar.hidden) positionToolbar();
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (!toolbar.hidden) positionToolbar();
  });

  toolbar.addEventListener('mousedown', function (event) {
    // Не терять выделение при клике по панели.
    if (event.target.closest('.wb-btn')) event.preventDefault();
  });

  toolbar.addEventListener('click', function (event) {
    var btn = event.target.closest('.wb-btn');
    if (!btn || !activeEditor) return;
    activeEditor.focus();
    restoreRange(activeEditor);
    var cmd = btn.dataset.cmd;
    if (cmd.indexOf('formatBlock:') === 0) {
      var block = cmd.split(':')[1];
      var current = (document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase();
      document.execCommand('formatBlock', false, current === block ? 'p' : block);
    } else {
      document.execCommand(cmd, false, null);
    }
    saveRange();
    syncEditor(activeEditor);
    positionToolbar();
  });

  function initEditor(textarea) {
    var form = textarea.closest('form');
    var editor = document.createElement('div');
    editor.className = 'wysiwyg-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.dataset.placeholder = textarea.dataset.placeholder || '';
    // Сервер отдаёт готовый sanitized HTML в data-html.
    if (textarea.dataset.html) editor.innerHTML = textarea.dataset.html;
    textarea.hidden = true;
    textarea.parentNode.insertBefore(editor, textarea.nextSibling);

    var turndown = new window.TurndownService({ headingStyle: 'atx', emDelimiter: '*' });

    function sync() {
      textarea.value = turndown.turndown(editor.innerHTML);
    }
    syncers.set(editor, sync);

    editor.addEventListener('focus', function () {
      activeEditor = editor;
    });
    editor.addEventListener('input', function () {
      // После удаления всего текста остаётся <br> — возвращаем плейсхолдер.
      if (!editor.textContent.trim() && !editor.querySelector('img, hr')) editor.innerHTML = '';
      sync();
    });
    editor.addEventListener('keyup', sync);
    editor.addEventListener('blur', sync);
    if (form) form.addEventListener('submit', sync);

    editor.addEventListener('wysiwyg:insert', function (event) {
      var text = event.detail && event.detail.text;
      if (text) insertText(editor, text);
    });

    sync();
  }

  document.querySelectorAll('textarea.js-wysiwyg').forEach(initEditor);
})();
