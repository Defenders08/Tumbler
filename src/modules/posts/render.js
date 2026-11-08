// Рендер текста постов: markdown -> санитизированный HTML.
// markdown-it с html:false не пропускает сырой HTML; sanitize-html — allowlist на выходе.
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const sanitizeOptions = {
  allowedTags: [
    'a', 'b', 'i', 'em', 'strong', 'u', 's', 'strike', 'code', 'pre', 'blockquote',
    'p', 'br', 'ul', 'ol', 'li', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'nofollow noopener' } }),
  },
};

// Тело текстового поста, подписи, описания ссылок.
export function renderMarkdown(text) {
  if (!text) return '';
  return sanitizeHtml(md.render(String(text)), sanitizeOptions);
}

// Простой текст без разметки (цитаты, источники) — экранирование + переносы строк.
export function renderPlain(text) {
  if (!text) return '';
  return sanitizeHtml(String(text), { allowedTags: [], allowedAttributes: {} }).replace(/\r?\n/g, '<br>');
}

export function isSafeLinkUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
