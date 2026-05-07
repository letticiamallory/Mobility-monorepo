/** Região de dados de linhas (scraping / ingestão). Alinhado ao OTP e ao app. */
export type LineRegionId = 'montes_claros' | 'brasilia' | 'sao_paulo';

export const LINE_REGION_IDS: LineRegionId[] = [
  'montes_claros',
  'brasilia',
  'sao_paulo',
];

export function parseLineRegion(value: unknown): LineRegionId | undefined {
  const s = `${value ?? ''}`.trim().toLowerCase();
  if (s === 'montes_claros' || s === 'montes-claros') return 'montes_claros';
  if (s === 'brasilia' || s === 'brasília' || s === 'df') return 'brasilia';
  if (s === 'sao_paulo' || s === 'são_paulo' || s === 'sp') return 'sao_paulo';
  return undefined;
}
