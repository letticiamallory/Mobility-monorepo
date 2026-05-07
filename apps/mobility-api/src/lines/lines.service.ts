import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Repository } from 'typeorm';
import { Line } from './line.entity';
import { parseLineRegion, type LineRegionId } from './line-region';
import { fetchSaoPauloLinesFromGtfs } from './lines-sp-gtfs';

@Injectable()
export class LinesService {
  private readonly logger = new Logger(LinesService.name);

  private static readonly SCRAPE_HTTP_OPTS = {
    timeout: 15_000,
    headers: {
      'User-Agent':
        'MobilityAPI/1.0 (lines scraper; +https://github.com/)',
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    },
  } as const;

  private static readonly BRASILIA_HTTP_OPTS = {
    timeout: 90_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
  } as const;

  private static readonly BRASILIA_BASE = 'https://brasiliamobilidade.com.br';

  constructor(
    @InjectRepository(Line)
    private readonly linesRepository: Repository<Line>,
  ) {}

  async findAll(search?: string, region?: string): Promise<Line[]> {
    const queryBuilder = this.linesRepository.createQueryBuilder('line');
    const reg = parseLineRegion(region);
    if (reg) {
      queryBuilder.andWhere('line.region = :reg', { reg });
    }

    if (search?.trim()) {
      const value = `%${search.trim()}%`;
      queryBuilder.andWhere(
        '(line.code ILIKE :value OR line.name ILIKE :value OR line.origin ILIKE :value OR line.destination ILIKE :value OR line.via ILIKE :value)',
        { value },
      );
    }

    const rows = await queryBuilder.orderBy('line.code', 'ASC').getMany();
    return rows.map((line) => this.withSanitizedSchedules(line));
  }

  async findById(id: number): Promise<Line> {
    const line = await this.linesRepository.findOne({ where: { id } });

    if (!line) {
      throw new NotFoundException(`Linha com id ${id} nao encontrada`);
    }

    return this.withSanitizedSchedules(line);
  }

  async seedFromWeb(): Promise<{
    saved: number;
    found: number;
    by_region: Record<LineRegionId, number>;
    errors?: string[];
  }> {
    const errors: string[] = [];
    let montesClaros: Array<Omit<Line, 'id' | 'created_at'>> = [];
    let brasilia: Array<Omit<Line, 'id' | 'created_at'>> = [];
    let saoPaulo: Array<Omit<Line, 'id' | 'created_at'>> = [];

    try {
      montesClaros = await this.scrapeMontesClarosLines();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`seed montes_claros: ${msg}`);
      errors.push(`montes_claros: ${msg}`);
    }

    try {
      brasilia = await this.scrapeBrasiliaLines();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`seed brasilia: ${msg}`);
      errors.push(`brasilia: ${msg}`);
    }

    try {
      saoPaulo = await fetchSaoPauloLinesFromGtfs(
        process.env.SPTRANS_GTFS_URL,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`seed sao_paulo: ${msg}`);
      errors.push(`sao_paulo: ${msg}`);
    }

    const scrapedLines: Array<Omit<Line, 'id' | 'created_at'>> = [
      ...montesClaros,
      ...brasilia,
      ...saoPaulo,
    ];

    if (scrapedLines.length === 0) {
      return {
        saved: 0,
        found: 0,
        by_region: { montes_claros: 0, brasilia: 0, sao_paulo: 0 },
        errors: errors.length ? errors : undefined,
      };
    }

    const toSave = scrapedLines.map((row) => ({
      ...row,
      schedules: this.sanitizeSchedulesArray(row.schedules),
    }));

    const chunk = 150;
    try {
      for (let i = 0; i < toSave.length; i += chunk) {
        await this.linesRepository.upsert(
          toSave.slice(i, i + chunk),
          ['region', 'code'],
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`lines upsert: ${msg}`);
      throw new BadRequestException(`Falha ao gravar linhas: ${msg}`);
    }

    const count = async (r: LineRegionId) =>
      this.linesRepository.count({ where: { region: r } });

    const by_region = {
      montes_claros: await count('montes_claros'),
      brasilia: await count('brasilia'),
      sao_paulo: await count('sao_paulo'),
    };

    return {
      saved: scrapedLines.length,
      found: scrapedLines.length,
      by_region,
      errors: errors.length ? errors : undefined,
    };
  }

  /** Remove tokens inválidos (ex. `"{}"` vindo de simple-array quebrado). */
  private sanitizeSchedulesArray(
    schedules: string[] | null | undefined,
  ): string[] | null {
    if (!schedules?.length) return null;
    const seen = new Set<string>();
    const out: string[] = [];
    const max = 800;
    for (const raw of schedules) {
      if (out.length >= max) break;
      if (typeof raw !== 'string') continue;
      const t = this.normalizeScheduleToken(raw);
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out.length > 0 ? out : null;
  }

  private withSanitizedSchedules(line: Line): Line {
    return {
      ...line,
      schedules: this.sanitizeSchedulesArray(line.schedules),
    };
  }

  private normalizeScheduleToken(token: string): string | null {
    const m = token.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  private extractSchedulesFromHtml(html: string): string[] {
    const timeRe = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
    const out: string[] = [];
    for (const match of html.matchAll(timeRe)) {
      const normalized = this.normalizeScheduleToken(`${match[1]}:${match[2]}`);
      if (normalized) out.push(normalized);
    }
    const seen = new Set<string>();
    return out.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  }

  private async scrapeLineSchedulesMontesClaros(
    code: string,
  ): Promise<string[] | null> {
    const normalized = code.trim();
    if (!normalized) return null;
    try {
      const { data } = await axios.get(
        `https://www.onibusmoc.com/linhas/${encodeURIComponent(normalized)}`,
        LinesService.SCRAPE_HTTP_OPTS,
      );
      const schedules = this.extractSchedulesFromHtml(String(data ?? ''));
      return schedules.length > 0 ? schedules : null;
    } catch {
      return null;
    }
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, limit) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        out[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }

  private async scrapeMontesClarosLines(): Promise<
    Array<Omit<Line, 'id' | 'created_at'>>
  > {
    const { data } = await axios.get(
      'https://www.onibusmoc.com/linhas',
      LinesService.SCRAPE_HTTP_OPTS,
    );
    const $ = cheerio.load(data);
    const parsedLines: Array<{
      code: string;
      name: string;
      origin: string;
      destination: string;
      via: string | null;
      accessible: boolean;
    }> = [];
    const seenCodes = new Set<string>();

    $('a[href^="/linhas/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const code = href.split('/').pop()?.trim() ?? '';
      const text = $(el).text().trim();
      if (!code || !text) return;
      if (seenCodes.has(code)) return;
      const match = text.match(
        /^(\w+)\s+(.+?)\s*\/\s*(.+?)(?:\s*-\s*Via\s*(.+))?$/i,
      );
      if (!match) return;
      const [, codeFromText, origin, destination, via] = match;
      const normalizedCode = String(codeFromText ?? code).trim();
      if (!normalizedCode) return;
      if (seenCodes.has(normalizedCode)) return;
      seenCodes.add(normalizedCode);
      parsedLines.push({
        code: normalizedCode,
        name: text.replace(/\s+/g, ' ').trim(),
        origin: origin.trim(),
        destination: destination.trim(),
        via: via?.trim() ?? null,
        accessible: true,
      });
    });

    if (parsedLines.length === 0) {
      $('a, li, div').each((_, element) => {
        const text = $(element).text().trim();
        const match = text.match(
          /^(\d+)\s+(.+?)\s*\/\s*(.+?)(?:\s*-\s*Via\s*(.+))?$/i,
        );
        if (!match) return;
        const [, code, origin, destination, via] = match;
        const normalizedCode = code.trim();
        if (!normalizedCode || seenCodes.has(normalizedCode)) return;
        seenCodes.add(normalizedCode);
        parsedLines.push({
          code: normalizedCode,
          name: text.replace(/\s+/g, ' ').trim(),
          origin: origin.trim(),
          destination: destination.trim(),
          via: via?.trim() ?? null,
          accessible: true,
        });
      });
    }

    const withSchedules = await this.mapWithConcurrency(parsedLines, 5, async (line) => {
      const schedules = await this.scrapeLineSchedulesMontesClaros(line.code);
      return {
        region: 'montes_claros' as const,
        ...line,
        schedules,
      } satisfies Omit<Line, 'id' | 'created_at'>;
    });

    return withSchedules;
  }

  /**
   * O site costuma embutir `/travel/slug` no HTML/JSON sem `href="/travel/..."`
   * em âncoras — extraímos do texto bruto. A página `/travels` lista milhares de linhas.
   */
  private collectBrasiliaTravelSlugsFromHtml(
    html: string,
    into: Set<string>,
  ): void {
    for (const m of html.matchAll(/\/travel\/([A-Za-z0-9._-]+)/g)) {
      const slug = m[1]?.trim();
      if (slug) into.add(slug);
    }
  }

  private async collectBrasiliaTravelSlugs(): Promise<string[]> {
    const travel = new Set<string>();

    try {
      const { data } = await axios.get(
        `${LinesService.BRASILIA_BASE}/travels`,
        LinesService.BRASILIA_HTTP_OPTS,
      );
      this.collectBrasiliaTravelSlugsFromHtml(String(data ?? ''), travel);
    } catch {
      /* fallback: cidades */
    }

    let citySlugs: string[] = [];
    try {
      const { data: homeHtml } = await axios.get(
        `${LinesService.BRASILIA_BASE}/`,
        LinesService.BRASILIA_HTTP_OPTS,
      );
      const cities = new Set<string>();
      for (const m of String(homeHtml).matchAll(/\/city\/([a-z0-9-]+)/gi)) {
        if (m[1]) cities.add(m[1]);
      }
      citySlugs = [...cities];
    } catch {
      citySlugs = [];
    }

    await this.mapWithConcurrency(citySlugs, 4, async (citySlug) => {
      try {
        const { data } = await axios.get(
          `${LinesService.BRASILIA_BASE}/city/${citySlug}`,
          LinesService.BRASILIA_HTTP_OPTS,
        );
        const raw = String(data ?? '');
        this.collectBrasiliaTravelSlugsFromHtml(raw, travel);
        const $ = cheerio.load(data);
        $('a[href^="/travel/"]').each((_, el) => {
          const href = $(el).attr('href') ?? '';
          const m = href.match(/\/travel\/([^/?#]+)/);
          if (m?.[1]) travel.add(m[1]);
        });
      } catch {
        /* ignora cidade com falha */
      }
    });

    const sorted = [...travel].sort();
    const capRaw = parseInt(process.env.LINES_BRASILIA_MAX_TRAVELS ?? '1200', 10);
    const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.min(capRaw, 8000) : 1200;
    return sorted.slice(0, cap);
  }

  private async scrapeBrasiliaLines(): Promise<
    Array<Omit<Line, 'id' | 'created_at'>>
  > {
    const slugs = await this.collectBrasiliaTravelSlugs();
    if (slugs.length === 0) return [];

    const rows = await this.mapWithConcurrency(slugs, 5, async (slug) => {
      try {
        const { data } = await axios.get(
          `${LinesService.BRASILIA_BASE}/travel/${encodeURIComponent(slug)}`,
          LinesService.BRASILIA_HTTP_OPTS,
        );
        const $ = cheerio.load(data);
        let name =
          $('h6').first().text().trim() ||
          $('h1').first().text().trim() ||
          slug;
        name = name.replace(/\s+/g, ' ').trim();
        const parts = name
          .split('/')
          .map((s) => s.trim())
          .filter(Boolean);
        const origin = parts[0] ?? name;
        const destination = parts[1] ?? parts[0] ?? name;
        const schedules = this.extractSchedulesFromHtml(String(data ?? ''));
        return {
          region: 'brasilia' as const,
          code: slug,
          name,
          origin,
          destination,
          via: null,
          accessible: true,
          schedules: schedules.length > 0 ? schedules : null,
        } satisfies Omit<Line, 'id' | 'created_at'>;
      } catch {
        return null;
      }
    });

    const out: Array<Omit<Line, 'id' | 'created_at'>> = [];
    for (const r of rows) {
      if (r) out.push(r);
    }
    return out;
  }
}
