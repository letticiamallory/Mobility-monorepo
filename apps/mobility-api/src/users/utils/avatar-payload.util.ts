import { BadRequestException } from '@nestjs/common';

/** Limite decodificado (2 MB) — cobre fotos “normais” de galeria após crop. */
export const MAX_USER_AVATAR_BYTES = 2 * 1024 * 1024;

export type ParsedAvatar = { buffer: Buffer; mime: string };

export function parseOptionalAvatarPayload(
  avatarBase64?: string | null,
  avatarMime?: string | null,
): ParsedAvatar | null {
  if (avatarBase64 == null || typeof avatarBase64 !== 'string') return null;
  const trimmed = avatarBase64.trim();
  if (trimmed.length === 0) return null;

  let raw = trimmed;
  let mime = (avatarMime ?? 'image/jpeg').trim() || 'image/jpeg';

  const dataUrl = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrl) {
    mime = dataUrl[1].trim().slice(0, 64);
    raw = dataUrl[2].trim();
  }

  const compact = raw.replace(/\s/g, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(compact, 'base64');
  } catch {
    throw new BadRequestException('Foto inválida (base64)');
  }

  if (buffer.length === 0) {
    throw new BadRequestException('Foto vazia');
  }
  if (buffer.length > MAX_USER_AVATAR_BYTES) {
    throw new BadRequestException(
      `A foto deve ter no máximo ${Math.floor(MAX_USER_AVATAR_BYTES / (1024 * 1024))} MB`,
    );
  }

  return { buffer, mime: mime.slice(0, 64) };
}

export function avatarToDataUrl(mime: string | null, data: Buffer | null): string | null {
  if (!data || data.length === 0) return null;
  const m = (mime ?? 'image/jpeg').trim() || 'image/jpeg';
  return `data:${m};base64,${data.toString('base64')}`;
}
