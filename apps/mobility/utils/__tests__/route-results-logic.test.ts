import {
  addMinutesToClock,
  formatClockFromNow,
  formatUnixToLocalClock,
  isClock,
  isWalkStageMode,
  minutesUntilClock,
  normalizeDepartureMinutes,
  normalizeStageMode,
  routeAttentionReason,
  routeCompanionAudience,
  routeDurationMinutes,
  routeIncidentCount,
  routeMatchesCompanionTab,
  routeNeedsAttention,
  routeSignature,
  routeTransportFamily,
  stageAttentionReason,
  stageDurationMinutes,
  stageMaxSeverity,
  stageNeedsAttention,
} from '../route-results-logic';

describe('routeDurationMinutes (pessimista)', () => {
  it('retorna 0 para string vazia e campos ausentes', () => {
    expect(routeDurationMinutes({})).toBe(0);
    expect(routeDurationMinutes({ total_duration: '' })).toBe(0);
    expect(routeDurationMinutes({ total_duration: '   ' })).toBe(0);
  });

  it('parsea só número sem unidade (primeiro grupo de dígitos)', () => {
    expect(routeDurationMinutes({ total_duration: '45' })).toBe(45);
    expect(routeDurationMinutes({ total_duration: 'foo 90 bar' })).toBe(90);
  });

  it('ignora “min” quando há horas no label', () => {
    expect(routeDurationMinutes({ total_duration: '1 h 15 min' })).toBe(75);
  });

  it('aceita variantes de casing em totalDuration/totalTime', () => {
    expect(routeDurationMinutes({ totalDuration: '20 MIN' })).toBe(20);
    expect(routeDurationMinutes({ totalTime: '2 H 0 min' })).toBe(120);
  });

  it('não explode com NaN em números estranhos — cai no fallback numérico ou 0', () => {
    expect(routeDurationMinutes({ total_duration: 'h min' })).toBe(0);
  });
});

describe('stageDurationMinutes', () => {
  it('espelha o mesmo parser da rota para estágio', () => {
    expect(stageDurationMinutes({ duration: '5 min' })).toBe(5);
    expect(stageDurationMinutes({ duration: 42 as unknown as string })).toBe(42);
  });
});

describe('normalizeDepartureMinutes', () => {
  it('retorna null para lixo e números negativos', () => {
    expect(normalizeDepartureMinutes(undefined)).toBeNull();
    expect(normalizeDepartureMinutes('x')).toBeNull();
    expect(normalizeDepartureMinutes(-1)).toBeNull();
  });

  it('array: primeiro número >= 0 ganha ("" vira 0)', () => {
    expect(normalizeDepartureMinutes(['', NaN, 12])).toBe(0);
    expect(normalizeDepartureMinutes([NaN, 'bad', 12])).toBe(12);
  });
});

describe('normalizeStageMode', () => {
  it('classifica variações e metrô', () => {
    expect(normalizeStageMode('WALKING')).toBe('walk');
    expect(normalizeStageMode('METRO')).toBe('subway');
    expect(normalizeStageMode('ônibus express')).toBe('bus');
    expect(normalizeStageMode('taxi')).toBe('other');
  });
});

describe('routeSignature — deduplicação estável', () => {
  it('mesma rota com casing diferente colide', () => {
    const a = {
      total_duration: '10 MIN',
      total_distance: '2 KM',
      stages: [{ mode: 'BUS', line_code: '100', stop_name: 'Centro' }],
    };
    const b = {
      total_duration: '10 min',
      total_distance: '2 km',
      stages: [{ mode: 'bus', line_code: '100', stop_name: 'centro' }],
    };
    expect(routeSignature(a)).toBe(routeSignature(b));
  });

  it('linha ou parada diferentes não colidem', () => {
    const base = { total_duration: '10 min', total_distance: '1 km', stages: [{ mode: 'bus', line_code: '1', stop_name: 'A' }] };
    expect(routeSignature(base)).not.toBe(
      routeSignature({ ...base, stages: [{ mode: 'bus', line_code: '2', stop_name: 'A' }] }),
    );
  });
});

describe('routeTransportFamily', () => {
  it('other quando só modos não transit', () => {
    expect(routeTransportFamily({ stages: [{ mode: 'ferry' }] })).toBe('other');
  });

  it('combined para ônibus + metrô sem caminhada explícita no conjunto filtrado', () => {
    expect(
      routeTransportFamily({
        stages: [{ mode: 'bus' }, { mode: 'subway' }],
      }),
    ).toBe('combined');
  });
});

describe('routeCompanionAudience — perfil e heurísticas', () => {
  it('search_profile vence campos ruidosos', () => {
    expect(
      routeCompanionAudience({
        search_profile: 'alone',
        accompanied: 'acompanhado sempre',
      }),
    ).toBe('alone');
  });

  it('null quando nenhum sinal', () => {
    expect(routeCompanionAudience({ profile: '   ' })).toBeNull();
  });

  it('ambíguo “sozinho” + “acompanhado” vira both', () => {
    expect(routeCompanionAudience({ accompanied: 'sozinho', recommended_for: 'acompanhado' })).toBe('both');
  });
});

describe('routeMatchesCompanionTab — acessibilidade e incidentes', () => {
  it('search_profile da API fixa a aba (listas já particionadas)', () => {
    expect(routeMatchesCompanionTab({ search_profile: 'alone' }, 'alone')).toBe(true);
    expect(routeMatchesCompanionTab({ search_profile: 'alone' }, 'companied')).toBe(false);
    expect(routeMatchesCompanionTab({ search_profile: 'companied' }, 'companied')).toBe(true);
    expect(routeMatchesCompanionTab({ search_profile: 'companied' }, 'alone')).toBe(false);
  });

  it('bloqueia rota inacessível só em sozinho; acompanhado exibe para orientação', () => {
    expect(routeMatchesCompanionTab({ accessible: false }, 'alone')).toBe(false);
    expect(routeMatchesCompanionTab({ accessible: false }, 'companied')).toBe(true);
  });

  it('sozinho exige 0 incidentes e rota calma', () => {
    expect(
      routeMatchesCompanionTab(
        { stages: [{ warning: 'obras' }], accessible: true },
        'alone',
      ),
    ).toBe(false);
  });

  it('acompanhado aceita até 2 incidentes', () => {
    expect(
      routeMatchesCompanionTab(
        {
          slope_warning: true,
          stages: [{ warning: 'a' }],
          accessible: true,
        },
        'companied',
      ),
    ).toBe(true);
  });

  it('acompanhado aceita muitos incidentes (rotas longas com vários trechos)', () => {
    expect(
      routeMatchesCompanionTab(
        {
          slope_warning: true,
          stages: [{ slope_warning: true }, { warning: 'a' }, { warning: 'b' }],
          accessible: true,
        },
        'companied',
      ),
    ).toBe(true);
  });
});

describe('stageNeedsAttention', () => {
  it('warning só espaços não conta', () => {
    expect(stageNeedsAttention({ warning: '  \n  ' })).toBe(false);
  });
});

describe('relógio e espera', () => {
  it('minutesUntilClock corre até o próximo 08:00 quando já passou o de hoje (hora local)', () => {
    const now = new Date(2026, 4, 2, 14, 30, 0);
    const mins = minutesUntilClock('08:00', now);
    expect(mins).toBeGreaterThan(17 * 60);
    expect(mins).toBeLessThan(18 * 60);
  });

  it('addMinutesToClock retorna HH:mm válido após offset', () => {
    const out = addMinutesToClock('10:00', 125);
    expect(out).toMatch(/^\d{2}:\d{2}$/);
    expect(out).toBe('12:05');
  });

  it('formatClockFromNow avança minutos locais', () => {
    const s = formatClockFromNow(10);
    expect(s).toMatch(/^\d{2}:\d{2}$/);
  });

  it('isClock valida formato HH:mm com dois dígitos nos minutos', () => {
    expect(isClock('09:05')).toBe(true);
    expect(isClock('9:5')).toBe(false);
    expect(isClock(undefined)).toBe(false);
  });

  it('formatUnixToLocalClock retorna HH:mm pt-BR', () => {
    const s = formatUnixToLocalClock(1_700_000_000);
    expect(s).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('isWalkStageMode', () => {
  it('aceita walk, walking e foot (alinhado ao backend)', () => {
    expect(isWalkStageMode('foot')).toBe(true);
    expect(isWalkStageMode('Foot')).toBe(true);
    expect(isWalkStageMode('WALKING')).toBe(true);
    expect(isWalkStageMode('walk')).toBe(true);
    expect(isWalkStageMode('bus')).toBe(false);
  });
});

describe('stageMaxSeverity / stageAttentionReason / stageNeedsAttention', () => {
  it('high é detectado em accessibility_report.blockers', () => {
    const stage = {
      mode: 'walk',
      accessibility_report: {
        confidence: 'high' as const,
        blockers: [{ type: 'stairs_or_steps', severity: 'high' as const }],
      },
    };
    expect(stageMaxSeverity(stage)).toBe('high');
    expect(stageNeedsAttention(stage)).toBe(true);
    expect(stageAttentionReason(stage)).toBe('Escadas/degraus mapeados');
  });

  it('warning textual sem blocker estruturado vira medium', () => {
    const stage = { mode: 'walk', warning: 'Buraco na calçada' };
    expect(stageMaxSeverity(stage)).toBe('medium');
    expect(stageNeedsAttention(stage)).toBe(true);
    expect(stageAttentionReason(stage)).toBe('Buraco na calçada');
  });

  it('apenas low (desvio ORS) não dispara aviso (atenção falsa)', () => {
    const stage = {
      mode: 'walk',
      accessibility_report: {
        confidence: 'high' as const,
        blockers: [{ type: 'ors_wheelchair_detour', severity: 'low' as const }],
      },
    };
    expect(stageMaxSeverity(stage)).toBe('low');
    expect(stageNeedsAttention(stage)).toBe(false);
  });
});

describe('routeNeedsAttention / routeAttentionReason', () => {
  it('rota com bloqueador medium em qualquer estágio precisa de atenção', () => {
    const route = {
      stages: [
        { mode: 'bus' },
        {
          mode: 'walk',
          accessibility_report: {
            confidence: 'medium' as const,
            blockers: [{ type: 'rough_surface', severity: 'medium' as const }],
          },
        },
      ],
    };
    expect(routeNeedsAttention(route)).toBe(true);
    expect(routeAttentionReason(route)).toBe('Calçada ou caminho irregular');
  });

  it('rota limpa não precisa de atenção', () => {
    const route = {
      accessible: true,
      slope_warning: false,
      stages: [{ mode: 'walk' }, { mode: 'bus' }],
    };
    expect(routeNeedsAttention(route)).toBe(false);
    expect(routeAttentionReason(route)).toBeNull();
  });
});

describe('routeIncidentCount — sem dupla contagem', () => {
  it('walk com slope_warning conta 1, não 2', () => {
    expect(
      routeIncidentCount({
        stages: [{ mode: 'walk', slope_warning: true }],
      }),
    ).toBe(1);
  });
});
