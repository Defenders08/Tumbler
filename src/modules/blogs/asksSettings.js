// Тумблеры Ask box из формы настроек блога (чекбоксы шлют 'on' или отсутствуют).
export function updateAskSettings(db, blogId, body) {
  const askEnabled = body.ask_enabled === 'on' ? 1 : 0;
  const askAnonymous = body.ask_anonymous === 'on' ? 1 : 0;
  // Анонимные вопросы не могут быть включены при выключенном ask box.
  db.prepare('UPDATE blogs SET ask_enabled = ?, ask_anonymous = ?, updated_at = ? WHERE id = ?').run(
    askEnabled,
    askEnabled ? askAnonymous : 0,
    Date.now(),
    blogId
  );
}
