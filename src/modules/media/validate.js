// Валидация и обработка загруженных файлов: проверка фактического содержимого
// по magic bytes (file-type), whitelist форматов, контроль размеров, обработка sharp.
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm']);
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'application/ogg']);
const MAX_IMAGE_EDGE = 1280;

export class MediaError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Проверяет буфер по назначению и возвращает готовые к сохранению данные.
 * purpose: 'image' (фото-пост) | 'gif' | 'audio' | 'video' | 'avatar' | 'cover'
 * Правило ТЗ: GIF — отдельный тип. Фото-посты принимают только статичные форматы.
 */
export async function processUpload(buffer, purpose, limits) {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) throw new MediaError('composer.errors.bad_media');
  const { mime, ext } = detected;

  if (purpose === 'image' || purpose === 'avatar' || purpose === 'cover') {
    if (mime === 'image/gif') {
      // GIF допустим только аватару (в духе 2012 года — даже анимированный).
      if (purpose !== 'avatar') throw new MediaError('composer.errors.gif_in_photo');
      if (buffer.byteLength > limits.gif) throw new MediaError('composer.errors.too_large_gif');
      const meta = await sharp(buffer).metadata();
      return { buffer, mime, ext, kind: 'avatar', width: meta.width, height: meta.height };
    }
    if (!IMAGE_MIMES.has(mime)) throw new MediaError('composer.errors.bad_image');
    if (buffer.byteLength > limits.image) throw new MediaError('composer.errors.too_large_image');
    // Перекодировка снимает EXIF и ограничивает размер; GIF сюда не попадает.
    // Фон блога — на всю страницу, поэтому допускаем крупнее, чем обычные картинки.
    const maxEdge = purpose === 'cover' ? 1920 : MAX_IMAGE_EDGE;
    const processed = await sharp(buffer)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const meta = await sharp(processed).metadata();
    return { buffer: processed, mime, ext, kind: purpose === 'image' ? 'image' : purpose, width: meta.width, height: meta.height };
  }

  if (purpose === 'gif') {
    if (mime !== 'image/gif') throw new MediaError('composer.errors.bad_image');
    if (buffer.byteLength > limits.gif) throw new MediaError('composer.errors.too_large_gif');
    const meta = await sharp(buffer).metadata();
    if (!meta.pages || meta.pages < 2) throw new MediaError('composer.errors.static_gif');
    // GIF не перекодируем — сохраняем анимацию как есть.
    return { buffer, mime, ext, kind: 'gif', width: meta.width, height: meta.height };
  }

  if (purpose === 'audio') {
    if (!AUDIO_MIMES.has(mime)) throw new MediaError('composer.errors.bad_audio');
    if (buffer.byteLength > limits.audio) throw new MediaError('composer.errors.too_large_audio');
    return { buffer, mime, ext, kind: 'audio', width: null, height: null };
  }

  if (purpose === 'video') {
    if (!VIDEO_MIMES.has(mime)) throw new MediaError('composer.errors.bad_video');
    if (buffer.byteLength > limits.video) throw new MediaError('composer.errors.too_large_video');
    return { buffer, mime, ext, kind: 'video', width: null, height: null };
  }

  throw new MediaError('composer.errors.bad_media');
}
