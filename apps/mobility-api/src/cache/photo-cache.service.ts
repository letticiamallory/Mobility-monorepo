import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhotoCache } from './photo-cache.entity';

@Injectable()
export class PhotoCacheService {
  constructor(
    @InjectRepository(PhotoCache)
    private repo: Repository<PhotoCache>,
  ) {}

  async get(key: string): Promise<string | null> {
    const cached = await this.repo.findOne({ where: { cache_key: key } });
    if (!cached) return null;
    if (cached.expires_at && cached.expires_at < new Date()) {
      await this.repo.delete({ cache_key: key });
      return null;
    }
    return cached.photo_url;
  }

  /** Lista de URLs (ex.: 3 Street Views); preferir quando `urls_json` existir. */
  async getBundle(key: string): Promise<string[] | null> {
    const cached = await this.repo.findOne({ where: { cache_key: key } });
    if (!cached) return null;
    if (cached.expires_at && cached.expires_at < new Date()) {
      await this.repo.delete({ cache_key: key });
      return null;
    }
    if (cached.urls_json) {
      try {
        const parsed = JSON.parse(cached.urls_json) as unknown;
        if (Array.isArray(parsed)) {
          const urls = parsed.filter((u) => typeof u === 'string' && u.startsWith('http'));
          return urls.length ? urls : null;
        }
      } catch {
        return null;
      }
    }
    if (cached.photo_url?.startsWith('http')) return [cached.photo_url];
    return null;
  }

  async set(
    key: string,
    url: string,
    source: string,
    expiresInDays?: number,
  ): Promise<void> {
    const expires_at = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    await this.repo.upsert(
      {
        cache_key: key,
        photo_url: url,
        urls_json: null,
        source,
        expires_at,
      },
      ['cache_key'],
    );
  }

  async setBundle(
    key: string,
    urls: string[],
    source: string,
    expiresInDays?: number,
  ): Promise<void> {
    const clean = urls.filter((u) => typeof u === 'string' && u.startsWith('http'));
    if (clean.length === 0) return;
    const expires_at = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    await this.repo.upsert(
      {
        cache_key: key,
        photo_url: clean[0],
        urls_json: JSON.stringify(clean),
        source,
        expires_at,
      },
      ['cache_key'],
    );
  }

  buildStationKey(lat: number, lng: number): string {
    return `station_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  }

  buildStreetViewKey(lat: number, lng: number, heading: number = 0): string {
    return `streetview_${lat.toFixed(4)}_${lng.toFixed(4)}_${heading}`;
  }

  /** Chave estável para pacote de fotos de um trecho de caminhada (meio do segmento). */
  buildWalkBundleKey(midLat: number, midLng: number): string {
    return `walk_bundle_${midLat.toFixed(5)}_${midLng.toFixed(5)}`;
  }
}
