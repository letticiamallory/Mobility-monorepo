const TIME_TOKEN_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Converte um item de horário da API (string, objeto, etc.) em "HH:MM". */
export function parseScheduleEntry(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const total = Math.trunc(value);
    if (total >= 0 && total < 24 * 60) {
      const h = Math.floor(total / 60);
      const m = total % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s || s === '[object Object]' || s === '{}' || s === '[]') return null;
    const match = s.match(TIME_TOKEN_RE);
    if (match) {
      const h = Number(match[1]);
      const m = Number(match[2]);
      if (h >= 0 && h < 24 && m >= 0 && m < 60) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const direct =
      asString(o.time) ||
      asString(o.departure_time) ||
      asString(o.departureTime) ||
      asString(o.hour_string);
    if (direct) return parseScheduleEntry(direct);
    const hRaw = o.hour ?? o.h ?? o.hours;
    const mRaw = o.minute ?? o.min ?? o.minutes ?? o.m;
    if (hRaw !== undefined && mRaw !== undefined) {
      const h = typeof hRaw === 'number' ? hRaw : parseInt(String(hRaw), 10);
      const m = typeof mRaw === 'number' ? mRaw : parseInt(String(mRaw), 10);
      if (!Number.isNaN(h) && !Number.isNaN(m) && h >= 0 && h < 24 && m >= 0 && m < 60) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

export function normalizeSchedulesFromApi(raw: unknown): string[] {
  const out: string[] = [];
  const visit = (x: unknown): void => {
    if (x == null) return;
    const single = parseScheduleEntry(x);
    if (single) {
      out.push(single);
      return;
    }
    if (Array.isArray(x)) {
      x.forEach(visit);
      return;
    }
    if (typeof x === 'string') {
      const s = x.trim();
      if (!s) return;
      if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
        try {
          visit(JSON.parse(s));
          return;
        } catch {
          /* tenta lista separada por vírgula */
        }
      }
      if (s.includes(',')) {
        s.split(',').forEach((part) => visit(part.trim()));
      }
      return;
    }
    if (typeof x === 'object') {
      Object.values(x as Record<string, unknown>).forEach(visit);
    }
  };
  visit(raw);
  const seen = new Set<string>();
  return out.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
}

/** Próximo ônibus / previsão única vinda da API (paradas, estações). */
export function normalizeNextBusFromApi(raw: unknown): string | null {
  if (raw == null) return null;
  const direct = parseScheduleEntry(raw);
  if (direct) return direct;
  const list = normalizeSchedulesFromApi(raw);
  return list[0] ?? null;
}

/** Próximo horário da lista em relação ao relógio local (mesmo dia). */
export function nextScheduleToday(schedules: string[]): string | null {
  const slots = schedules.map((v) => parseScheduleEntry(v)).filter((s): s is string => Boolean(s));
  if (slots.length === 0) return null;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (const value of slots) {
    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const total = h * 60 + m;
    if (total >= nowMinutes) return value;
  }
  return slots[0] ?? null;
}
