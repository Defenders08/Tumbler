// Минималистичный логгер: время, уровень, сообщение.
const stamp = () => new Date().toISOString();

export const log = {
  info: (...args) => console.log(stamp(), '[info]', ...args),
  warn: (...args) => console.warn(stamp(), '[warn]', ...args),
  error: (...args) => console.error(stamp(), '[error]', ...args),
};
