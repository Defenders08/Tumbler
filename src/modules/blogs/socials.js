// Социальные ссылки блога: список поддерживаемых сетей и нормализация ввода.
// Хранятся в theme.socials (JSON), порядок = порядок в шапке блога.

export const SOCIAL_NETWORKS = ['telegram', 'vk', 'instagram', 'x', 'youtube', 'tiktok', 'soundcloud', 'spotify', 'website'];

export const MAX_SOCIALS = 8;

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
};

// Ссылка должна быть http(s); «t.me/foo» без схемы тоже принимаем.
export function normalizeUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 300) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProto);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeSocials(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const network = SOCIAL_NETWORKS.includes(item.network) ? item.network : 'website';
    const url = normalizeUrl(item.url);
    if (!url || seen.has(url)) continue;
    const label = String(item.label ?? '').trim().slice(0, 40);
    out.push({ network, label, url });
    seen.add(url);
    if (out.length >= MAX_SOCIALS) break;
  }
  return out;
}

// Форма присылает три массива одинаковой длины; пустые/битые строки отбрасываем.
export function normalizeSocials(body, translate) {
  const networks = asArray(body.social_network);
  const labels = asArray(body.social_label);
  const urls = asArray(body.social_url);
  const rows = urls.map((url, i) => {
    const network = SOCIAL_NETWORKS.includes(networks[i]) ? networks[i] : 'website';
    const label = String(labels[i] ?? '').trim();
    return { network, label: label || translate(`social_net.${network}`), url };
  });
  return sanitizeSocials(rows);
}
