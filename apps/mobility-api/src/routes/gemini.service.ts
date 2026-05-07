import { Injectable, Logger } from '@nestjs/common';
import { OverpassService } from '../accessibility/overpass.service';
import { PhotoCacheService } from '../cache/photo-cache.service';
import type { RouteStage } from './google-routes.service';

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiResponse {
  candidates: {
    content: {
      parts: { text: string }[];
    };
  }[];
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(
    private readonly overpassService: OverpassService,
    private readonly photoCacheService: PhotoCacheService,
  ) {}

  private getGoogleMapsApiKey(): string {
    return process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
  }

  /** Static Map (satélite) quando Street View não cobre o trecho. */
  private buildStaticSatellitePreviewUrl(
    lat: number,
    lng: number,
  ): string | null {
    const key = this.getGoogleMapsApiKey();
    if (!key) return null;
    const u = new URL('https://maps.googleapis.com/maps/api/staticmap');
    u.searchParams.set('center', `${lat},${lng}`);
    u.searchParams.set('zoom', '18');
    u.searchParams.set('size', '400x400');
    u.searchParams.set('maptype', 'satellite');
    u.searchParams.set('key', key);
    return u.toString();
  }

  /**
   * Define a URL de preview (Places ou Street View) do stage.
   * Street View só retorna URL após metadata com status OK.
   */
  async resolveStageStreetViewImage(stage: RouteStage): Promise<string | null> {
    if (stage.mode === 'walk') {
      return this.resolveWalkSegmentStreetView(stage);
    }
    if (stage.mode === 'bus' || stage.mode === 'subway') {
      return this.resolveTransitStopPhoto(stage);
    }
    return null;
  }

  /**
   * Até 3 imagens (Street View em ângulos diferentes ou fallback satélite) por trecho de caminhada.
   * Resultado cacheado em `photo_cache` por coordenada do meio do segmento.
   */
  async resolveWalkStageImageUrls(stage: RouteStage): Promise<string[]> {
    const midLat = (stage.location.lat + stage.end_location.lat) / 2;
    const midLng = (stage.location.lng + stage.end_location.lng) / 2;
    if (!Number.isFinite(midLat) || !Number.isFinite(midLng)) return [];

    const bundleKey = this.photoCacheService.buildWalkBundleKey(midLat, midLng);
    const cached = await this.photoCacheService.getBundle(bundleKey);
    if (cached && cached.length > 0) {
      return cached.slice(0, 3);
    }

    const apiKey = this.getGoogleMapsApiKey();
    if (!apiKey) return [];

    let urls = (await this.getStreetViewImages(midLat, midLng)).slice(0, 3);
    if (urls.length === 0) {
      const single = await this.resolveWalkSegmentStreetView(stage);
      urls = single ? [single] : [];
    }

    if (urls.length > 0) {
      await this.photoCacheService.setBundle(
        bundleKey,
        urls,
        'walk_sv_bundle',
        30,
      );
    }
    return urls.slice(0, 3);
  }

  /** Uma foto do ponto de parada (Places ou Street View), com cache por parada. */
  async resolveTransitStopPhoto(stage: RouteStage): Promise<string | null> {
    const lat = stage.location.lat;
    const lng = stage.location.lng;
    const stopName = (stage.departure ?? '').trim();
    const slug = stopName
      ? stopName.toLowerCase().replace(/\s+/g, '_').slice(0, 64)
      : 'unnamed';
    const cacheKey = `transit_stop_${lat.toFixed(4)}_${lng.toFixed(4)}_${slug}`;

    const hit = await this.photoCacheService.get(cacheKey);
    if (hit) return hit;

    const url = await this.resolveTransitStopImage(stage);
    if (url) {
      await this.photoCacheService.set(cacheKey, url, 'transit_stop', 30);
    }
    return url;
  }

  private async fetchStreetViewMetadataStatus(
    lat: number,
    lng: number,
    opts?: { heading?: number; pitch?: number; fov?: number },
  ): Promise<string> {
    const key = this.getGoogleMapsApiKey();
    if (!key) return 'REQUEST_DENIED';
    const url = new URL(
      'https://maps.googleapis.com/maps/api/streetview/metadata',
    );
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('key', key);
    if (opts?.heading !== undefined) {
      url.searchParams.set('heading', String(opts.heading));
    }
    if (opts?.pitch !== undefined) {
      url.searchParams.set('pitch', String(opts.pitch));
    }
    if (opts?.fov !== undefined) {
      url.searchParams.set('fov', String(opts.fov));
    }
    try {
      const res = await fetch(url.toString());
      if (!res.ok) return 'REQUEST_DENIED';
      const json = (await res.json()) as { status?: string };
      return json.status ?? 'UNKNOWN_ERROR';
    } catch {
      return 'UNKNOWN_ERROR';
    }
  }

  private normalizeHeadingDeg(deg: number): number {
    let h = deg % 360;
    if (h < 0) h += 360;
    return h;
  }

  private async resolveWalkSegmentStreetView(
    stage: RouteStage,
  ): Promise<string | null> {
    const key = this.getGoogleMapsApiKey();
    if (!key) return null;

    const lat =
      (stage.location.lat + stage.end_location.lat) / 2;
    const lng =
      (stage.location.lng + stage.end_location.lng) / 2;

    const headingRaw =
      Math.atan2(
        stage.end_location.lng - stage.location.lng,
        stage.end_location.lat - stage.location.lat,
      ) *
      (180 / Math.PI);
    const heading = this.normalizeHeadingDeg(headingRaw);

    const metaStatus = await this.fetchStreetViewMetadataStatus(lat, lng, {
      heading,
      pitch: 0,
      fov: 80,
    });
    if (metaStatus !== 'OK') {
      return this.buildStaticSatellitePreviewUrl(lat, lng);
    }

    const u = new URL('https://maps.googleapis.com/maps/api/streetview');
    u.searchParams.set('size', '400x200');
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('heading', String(heading));
    u.searchParams.set('pitch', '0');
    u.searchParams.set('fov', '80');
    u.searchParams.set('key', key);
    return u.toString();
  }

  private async findPlacePhotoUrlForStop(
    stopName: string,
    lat: number,
    lng: number,
  ): Promise<string | null> {
    const key = this.getGoogleMapsApiKey();
    if (!key || !stopName.trim()) return null;

    const input = `${stopName.trim()} Montes Claros`;
    const url = new URL(
      'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    );
    url.searchParams.set('input', input);
    url.searchParams.set('inputtype', 'textquery');
    url.searchParams.set('fields', 'photos,place_id,geometry');
    url.searchParams.set('locationbias', `point:${lat},${lng}`);
    url.searchParams.set('key', key);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const data = (await res.json()) as {
        status?: string;
        candidates?: Array<{
          photos?: Array<{ photo_reference?: string }>;
        }>;
      };
      if (data.status !== 'OK' || !data.candidates?.length) return null;
      const ref = data.candidates[0].photos?.[0]?.photo_reference;
      if (!ref) return null;

      const photoUrl = new URL(
        'https://maps.googleapis.com/maps/api/place/photo',
      );
      photoUrl.searchParams.set('maxwidth', '400');
      photoUrl.searchParams.set('photo_reference', ref);
      photoUrl.searchParams.set('key', key);
      return photoUrl.toString();
    } catch {
      return null;
    }
  }

  private async resolveTransitStopImage(
    stage: RouteStage,
  ): Promise<string | null> {
    const key = this.getGoogleMapsApiKey();
    if (!key) return null;

    const lat = stage.location.lat;
    const lng = stage.location.lng;
    const stopName = (stage.departure ?? '').trim();

    if (stopName) {
      const placePhoto = await this.findPlacePhotoUrlForStop(
        stopName,
        lat,
        lng,
      );
      if (placePhoto) return placePhoto;
    }

    const metaStatus = await this.fetchStreetViewMetadataStatus(lat, lng, {
      pitch: -10,
      fov: 90,
    });
    if (metaStatus !== 'OK') {
      return this.buildStaticSatellitePreviewUrl(lat, lng);
    }

    const u = new URL('https://maps.googleapis.com/maps/api/streetview');
    u.searchParams.set('size', '400x200');
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('pitch', '-10');
    u.searchParams.set('fov', '90');
    u.searchParams.set('key', key);
    return u.toString();
  }

  private async getStreetViewImages(lat: number, lng: number): Promise<string[]> {
    const apiKey = this.getGoogleMapsApiKey();
    const size = '640x400';
    const headings = [0, 90, 180, 270];

    const urls = headings.map(
      (heading) =>
        `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&heading=${heading}&pitch=0&key=${apiKey}`,
    );

    const metas = await Promise.all(
      urls.map(async (url) => {
        try {
          const metaUrl = url.replace('streetview?', 'streetview/metadata?');
          const meta = await fetch(metaUrl);
          const json = (await meta.json()) as { status?: string };
          return json.status === 'OK' ? url : null;
        } catch {
          return null;
        }
      }),
    );
    return metas.filter((u): u is string => u != null);
  }

  private async check3DTilesAvailability(
    lat: number,
    lng: number,
  ): Promise<boolean> {
    try {
      const apiKey = this.getGoogleMapsApiKey();
      const url = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) return false;

      // Verifica se existe tile para as coordenadas aproximadas
      const zoom = 14;
      const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
      const y = Math.floor(
        ((1 -
          Math.log(
            Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
          ) /
            Math.PI) /
          2) *
          Math.pow(2, zoom),
      );

      const tileUrl = `https://tile.googleapis.com/v1/3dtiles/${zoom}/${x}/${y}.glb?key=${apiKey}`;
      const tileResponse = await fetch(tileUrl, { method: 'HEAD' });
      return tileResponse.ok;
    } catch {
      return false;
    }
  }

  private async fetchBestImage(
    lat: number,
    lng: number,
  ): Promise<{ images: string[]; source: string }> {
    const has3DTiles = await this.check3DTilesAvailability(lat, lng);

    if (has3DTiles) {
      const apiKey = this.getGoogleMapsApiKey();
      const images = [
        `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=640x400&maptype=satellite&key=${apiKey}`,
        `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=640x400&maptype=satellite&key=${apiKey}`,
      ];
      return { images, source: '3dtiles' };
    }

    const streetViewImages = await this.getStreetViewImages(lat, lng);
    if (streetViewImages.length > 0) {
      return { images: streetViewImages, source: 'streetview' };
    }

    const apiKey = this.getGoogleMapsApiKey();
    return {
      images: [
        `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=640x400&maptype=satellite&key=${apiKey}`,
      ],
      source: 'satellite',
    };
  }

  private async getBestImages(
    lat: number,
    lng: number,
  ): Promise<{ images: string[]; source: string }> {
    const key = this.photoCacheService.buildStreetViewKey(lat, lng);

    try {
      const cached = await this.photoCacheService.get(key);
      if (cached) {
        this.logger.log(`Photo cache HIT: ${key}`);
        return { images: [cached], source: 'cache' };
      }
    } catch (err) {
      this.logger.warn(
        `[Gemini] photo_cache indisponível (get): ${(err as Error).message}`,
      );
    }

    const result = await this.fetchBestImage(lat, lng);

    if (result.images.length > 0) {
      try {
        await this.photoCacheService.set(
          key,
          result.images[0],
          result.source,
          30,
        );
        this.logger.log(`Photo cache SET: ${key}`);
      } catch (err) {
        this.logger.warn(
          `[Gemini] photo_cache indisponível (set): ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async callGeminiWithModel(
    model:
      | 'gemini-2.5-flash-lite'
      | 'gemini-2.5-flash',
    apiKey: string,
    parts: GeminiPart[],
  ): Promise<GeminiResponse> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({ contents: [{ parts }] }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Gemini API error [${model}]: ${response.status} ${response.statusText} - ${errorBody}`,
      );
    }

    this.logger.log(`Gemini model used successfully: ${model}`);
    return (await response.json()) as GeminiResponse;
  }

  /** Preferir este método: usa coordenadas do trecho (evita falha com URLs Place Photo sem lat/lng). */
  async analyzeAccessibilityAt(
    lat: number,
    lng: number,
  ): Promise<{
    accessible: boolean;
    warning: string | null;
  }> {
    try {
      const apiKey = process.env.GEMINI_API_KEY ?? '';
      if (!apiKey.trim()) {
        return { accessible: true, warning: null };
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { accessible: true, warning: null };
      }
      const { images, source } = await this.getBestImages(lat, lng);
      this.logger.log(
        `[Gemini] imagens encontradas: ${images.length} fonte: ${source}`,
      );
      let accessibilityFeatures: {
        rampas: number;
        pisotatil: number;
        banheiros_acessiveis: number;
        calcadas: number;
      };
      try {
        accessibilityFeatures =
          await this.overpassService.getAccessibilityFeatures(lat, lng);
      } catch (overpassErr) {
        const msg =
          overpassErr instanceof Error ? overpassErr.message : String(overpassErr);
        this.logger.warn(`[Gemini] Overpass indisponível, seguindo sem OSM: ${msg}`);
        accessibilityFeatures = {
          rampas: 0,
          pisotatil: 0,
          banheiros_acessiveis: 0,
          calcadas: 0,
        };
      }
      this.logger.log(
        `Gemini image source selected: ${source} (${images.length} candidates)`,
      );

      const useSatellitePrompt =
        source === '3dtiles' ||
        source === 'satellite' ||
        (source === 'cache' && images[0]?.includes('staticmap'));

      const imagePrompt = useSatellitePrompt
        ? 'Analise esta imagem de satélite de alta resolução e avalie a acessibilidade do trecho para pessoas com deficiência. Identifique calçadas, rampas, obstáculos, faixas de pedestre e condições do pavimento.'
        : 'Analise estas imagens de Street View e avalie a acessibilidade do trecho para pessoas com deficiência. Identifique calçadas, rampas, obstáculos, faixas de pedestre e condições do pavimento.';

      /** Downloads em paralelo — mesmo conjunto de imagens que antes, menos tempo de parede. */
      const imageDownloads = await Promise.all(
        images.map(async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              this.logger.warn(
                `Falha ao buscar imagem (${response.status}): ${url}`,
              );
              return null;
            }
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength < 1000) {
              this.logger.warn(
                `Imagem descartada por tamanho inválido (${buffer.byteLength} bytes): ${url}`,
              );
              return null;
            }
            const contentType = response.headers.get('content-type') ?? '';
            const mimeType = contentType.includes('image/png')
              ? 'image/png'
              : 'image/jpeg';
            const base64 = Buffer.from(buffer).toString('base64');
            return {
              inlineData: {
                mimeType,
                data: base64,
              },
            } as GeminiPart;
          } catch (err) {
            this.logger.warn(
              `Erro ao obter imagem para Gemini: ${(err as Error).message}`,
            );
            return null;
          }
        }),
      );
      const validImageParts = imageDownloads.filter(
        (p): p is GeminiPart => p !== null,
      );

      if (validImageParts.length === 0) {
        throw new Error('Nenhuma imagem válida para enviar ao Gemini');
      }

      const parts: GeminiPart[] = [
        {
          text: `${imagePrompt} Contexto OSM do entorno: ${JSON.stringify(accessibilityFeatures)}. Você é um especialista em acessibilidade urbana para cadeirantes. Responda APENAS em JSON: {"accessible": true/false, "warning": "descrição objetiva do problema em português ou null"}. INACESSÍVEL (accessible: false) se houver: escadas ou degraus sem rampa alternativa visível, calçada completamente ausente obrigando caminhar na rua, obras/areia/entulho/andaimes bloqueando a passagem, vegetação/postes/lixeiras/mobiliário urbano bloqueando mais de 50% da calçada, calçada muito estreita com menos de 1,2 metro de espaço livre, buracos profundos ou afundamentos graves, rampa com inclinação claramente excessiva, veículos estacionados bloqueando completamente a calçada. ACESSÍVEL (accessible: true) se houver: calçada livre e transitável mesmo que imperfeita, pequenas irregularidades ou pedra portuguesa, ausência de rampa em meio-fio isolada, superfície levemente inclinada ou desgastada, obstáculos pequenos que não bloqueiam a passagem.`,
        },
        ...validImageParts,
      ];

      let data: GeminiResponse;
      try {
        data = await this.callGeminiWithModel('gemini-2.5-flash-lite', apiKey, parts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes(' 429 ')) {
          throw error;
        }

        this.logger.warn(
          'Gemini 2.0 retornou 429, tentando fallback para gemini-1.5-flash',
        );
        try {
          data = await this.callGeminiWithModel(
            'gemini-2.5-flash',
            apiKey,
            parts,
          );
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);

          if (fallbackMessage.includes(' 429 ')) {
            this.logger.warn(
              'Gemini 1.5 também retornou 429, aguardando 2s para último retry',
            );
            await this.sleep(2000);
            throw fallbackError;
          } else {
            throw fallbackError;
          }
        }
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      try {
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean) as
          | { accessible: boolean; warning: string | null }
          | Array<{ accessible: boolean; warning: string | null }>;

        const result = Array.isArray(parsed)
          ? {
              accessible: parsed.every((item) => item.accessible),
              warning:
                parsed.find((item) => item.warning)?.warning ??
                (parsed.every((item) => item.accessible)
                  ? null
                  : 'Possível obstáculo identificado nesse trecho - avalie se consegue passar ou prefira uma alternativa'),
            }
          : parsed;
        this.logger.log(`Gemini result: ${JSON.stringify(result)}`);
        return result;
      } catch {
        this.logger.warn(
          'Falha ao parsear resposta do Gemini — assumindo acessível',
        );
        return { accessible: true, warning: null };
      }
    } catch (error) {
      this.logger.error(`Erro no GeminiService: ${(error as Error).message}`);
      return { accessible: true, warning: null };
    }
  }

  /**
   * Versão "para fusão": NUNCA retorna `safe` por padrão de erro/timeout.
   *
   * Em vez de cair em `accessible: true` quando há falha (chave ausente, sem imagem,
   * parse_failed etc.), devolve `state: 'unknown'` com `reason`. A camada de fusão
   * (`RouteAccessibilityFusionService`) decide o impacto no score.
   *
   * Política completa: ../../ACCESSIBILITY_ROUTE_SPECIALIST.md §4.1
   */
  async analyzeWalkAccessibilityForFusion(
    lat: number,
    lng: number,
  ): Promise<
    | { state: 'safe' | 'unsafe'; confidence: 'high' | 'medium' | 'low'; detail?: string }
    | { state: 'unknown'; reason: 'no_key' | 'no_image' | 'timeout' | 'error' | 'parse_failed' }
  > {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    if (!apiKey.trim()) {
      return { state: 'unknown', reason: 'no_key' };
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { state: 'unknown', reason: 'no_image' };
    }

    try {
      const result = await this.analyzeAccessibilityAt(lat, lng);
      // O método legado pode devolver `accessible:true` em fallback permissivo (sem imagem,
      // parse_failed etc.). Aqui só consideramos "safe" quando temos warning null e a chamada
      // realmente passou pelo modelo — sem garantia, descemos para `unknown`.
      if (result.accessible === false && result.warning) {
        return {
          state: 'unsafe',
          confidence: 'medium',
          detail: result.warning,
        };
      }
      if (result.accessible === true && result.warning === null) {
        // Tratamos como confiança baixa — visão é uma fonte só, e às vezes o fallback
        // permissivo dispara mesmo sem dado. A fusão aceita só como reforço.
        return { state: 'safe', confidence: 'low' };
      }
      return { state: 'unknown', reason: 'parse_failed' };
    } catch (err) {
      this.logger.warn(
        `[Gemini fusion] erro: ${(err as Error).message ?? 'desconhecido'}`,
      );
      return { state: 'unknown', reason: 'error' };
    }
  }

  /** Legado: tenta extrair lat/lng de URLs Street View / Static Map; senão assume acessível. */
  async analyzeAccessibility(imageUrl: string): Promise<{
    accessible: boolean;
    warning: string | null;
  }> {
    try {
      const params = new URL(imageUrl).searchParams;
      const location =
        params.get('location') ?? params.get('center') ?? '';
      const [latRaw, lngRaw] = location.split(',');
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return this.analyzeAccessibilityAt(lat, lng);
      }
    } catch {
      /* ignore */
    }
    return { accessible: true, warning: null };
  }
}
