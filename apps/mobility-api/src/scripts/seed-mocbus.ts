import axios from 'axios';
import * as cheerio from 'cheerio';
import { Client } from 'pg';

type SeedLine = {
  code: string;
  name: string;
  origin: string;
  destination: string;
  schedules: string[];
  stops: string[];
};

function parseLineText(text: string): SeedLine | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;

  const match =
    clean.match(
      /^(\d{2,5})\s*[-–]?\s*(.+?)\s*\/\s*(.+?)(?:\s*-\s*Via\s*(.+))?$/i,
    ) ?? clean.match(/^(\d{2,5})\s+(.+)$/);

  if (!match) return null;

  const code = match[1].trim();
  const origin = (match[2] ?? clean).trim();
  const destination = (match[3] ?? '').trim() || origin;
  const via = (match[4] ?? '').trim();

  return {
    code,
    name: clean,
    origin,
    destination,
    schedules: [],
    stops: via ? via.split(/\s*-\s*/).filter(Boolean) : [],
  };
}

async function scrapeMocBus(): Promise<SeedLine[]> {
  const rootUrl = 'https://onibus.online/empresas/mocbus';
  const { data } = await axios.get(rootUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 MobilityAPI Seeder' },
  });
  const $ = cheerio.load(data);
  const linesByCode = new Map<string, SeedLine>();

  $('a, li, div, tr, h1, h2, h3, h4').each((_, element) => {
    const text = $(element).text();
    const parsed = parseLineText(text);
    if (!parsed) return;

    if (!linesByCode.has(parsed.code)) {
      linesByCode.set(parsed.code, parsed);
      return;
    }

    const current = linesByCode.get(parsed.code)!;
    current.schedules.push(...parsed.schedules);
    current.stops.push(...parsed.stops);
  });

  return [...linesByCode.values()].map((line) => ({
    ...line,
    schedules: [...new Set(line.schedules)].slice(0, 200),
    stops: [...new Set(line.stops)].slice(0, 200),
  }));
}

async function saveToDatabase(lines: SeedLine[]) {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres123',
    database: process.env.DATABASE_NAME || 'Mobility',
  });

  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS lines (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      origin VARCHAR(255) NOT NULL,
      destination VARCHAR(255) NOT NULL,
      via VARCHAR(255) NULL,
      accessible BOOLEAN NOT NULL DEFAULT true,
      schedules TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS gtfs_stops (
      id SERIAL PRIMARY KEY,
      line_code VARCHAR(20) NOT NULL,
      stop_name VARCHAR(255) NOT NULL,
      stop_sequence INT NOT NULL DEFAULT 0,
      lat DOUBLE PRECISION NULL,
      lng DOUBLE PRECISION NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  for (const line of lines) {
    await client.query(
      `
      INSERT INTO lines (code, name, origin, destination, via, accessible, schedules)
      VALUES ($1, $2, $3, $4, NULL, true, $5)
      ON CONFLICT (code)
      DO UPDATE SET
        name = EXCLUDED.name,
        origin = EXCLUDED.origin,
        destination = EXCLUDED.destination,
        schedules = EXCLUDED.schedules
      `,
      [line.code, line.name, line.origin, line.destination, line.schedules],
    );

    await client.query('DELETE FROM gtfs_stops WHERE line_code = $1', [line.code]);
    for (let i = 0; i < line.stops.length; i += 1) {
      await client.query(
        `
        INSERT INTO gtfs_stops (line_code, stop_name, stop_sequence)
        VALUES ($1, $2, $3)
        `,
        [line.code, line.stops[i], i + 1],
      );
    }
  }

  await client.end();
}

async function main() {
  const lines = await scrapeMocBus();
  console.log(`Linhas encontradas na MOC BUS: ${lines.length}`);
  if (lines.length > 0) {
    console.log(
      `Exemplo: ${JSON.stringify(
        {
          code: lines[0].code,
          name: lines[0].name,
          origin: lines[0].origin,
          destination: lines[0].destination,
          schedules: lines[0].schedules.slice(0, 5),
          stops: lines[0].stops.slice(0, 5),
        },
        null,
        2,
      )}`,
    );
  }

  await saveToDatabase(lines);
  console.log('Seed MOC BUS concluído (lines + gtfs_stops).');
}

main().catch((error) => {
  console.error('Erro no seed-mocbus:', error);
  process.exit(1);
});
