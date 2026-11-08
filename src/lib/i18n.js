// i18n: словари ru/en, перевод с интерполяцией, определение языка запроса.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dictionaries = {};
for (const lang of ['ru', 'en']) {
  dictionaries[lang] = JSON.parse(fs.readFileSync(path.join(__dirname, `../../src/locales/${lang}.json`), 'utf8'));
}

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function translate(lang, key, params) {
  const raw = lookup(dictionaries[lang] ?? {}, key) ?? lookup(dictionaries.ru, key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

// Определение языка: настройка пользователя → cookie → Accept-Language → дефолт.
export function detectLocale(req, user) {
  const fromUser = user?.locale;
  if (fromUser === 'ru' || fromUser === 'en') return fromUser;
  const fromCookie = req.cookies?.['tumbler.lang'];
  if (fromCookie === 'ru' || fromCookie === 'en') return fromCookie;
  const accept = req.headers?.['accept-language'] ?? '';
  if (/en/i.test(accept.split(',')[0] ?? '')) return 'en';
  if (/ru/i.test(accept.split(',')[0] ?? '')) return 'ru';
  return 'ru';
}
