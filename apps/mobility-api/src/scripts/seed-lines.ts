import axios from 'axios';
import * as cheerio from 'cheerio';

async function seedLines() {
  const { data } = await axios.get('https://www.onibusmoc.com/linhas');
  const $ = cheerio.load(data);

  const lines: Array<{
    code: string;
    name: string;
    origin: string;
    destination: string;
    via: string | null;
    accessible: boolean;
  }> = [];

  $('a, li, div').each((_, element) => {
    const text = $(element).text().trim();
    const match = text.match(
      /^(\d+)\s+(.+?)\s*\/\s*(.+?)(?:\s*-\s*Via\s*(.+))?$/i,
    );

    if (!match) {
      return;
    }

    const [, code, origin, destination, via] = match;
    lines.push({
      code: code.trim(),
      name: text.trim(),
      origin: origin.trim(),
      destination: destination.trim(),
      via: via?.trim() ?? null,
      accessible: true,
    });
  });

  console.log(`Encontradas ${lines.length} linhas`);
  console.log(JSON.stringify(lines.slice(0, 5), null, 2));

  return lines;
}

seedLines().catch(console.error);
