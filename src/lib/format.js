// Утилиты форматирования дат для шаблонов.
export function formatDate(ts, lang = 'ru', timeZone = 'UTC') {
  if (!ts) return '';
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
}
