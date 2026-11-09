// Движок шаблонов liquidjs + фильтры переводов и дат.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Liquid } from 'liquidjs';
import { translate } from './i18n.js';
import { formatDate } from './format.js';
import { embedUrlFor } from '../modules/posts/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const viewsDir = path.resolve(__dirname, '../views');

export function createLiquidEngine(config) {
  const engine = new Liquid({
    root: viewsDir,
    extname: '.liquid',
    cache: config.isProduction,
    jsTruthy: true,
  });

  // {{ 'nav.dashboard' | t: locale }} — язык передаётся явно, без скрытого состояния.
  engine.registerFilter('t', (key, lang, params) => translate(lang ?? 'ru', String(key), params));
  engine.registerFilter('date', (ts, lang, tz) => formatDate(ts, lang, tz || 'UTC'));
  engine.registerFilter('urlencode', (value) => encodeURIComponent(String(value ?? '')));
  engine.registerFilter('embedUrl', (url, type) => embedUrlFor(url, type) ?? '');

  return engine;
}
