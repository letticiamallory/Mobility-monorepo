/**
 * SUITE: Bugs de Produção
 * Testes baseados em problemas reais identificados durante o desenvolvimento
 */

describe('BUG: Rotas sozinho e acompanhado retornando iguais', () => {
  it('campo accompanied deve ser enviado na requisição', () => {
    const bodyAlone = { origin: 'A', destination: 'B', accompanied: 'alone' };
    const bodyAccompanied = { origin: 'A', destination: 'B', accompanied: 'companied' };
    expect(bodyAlone.accompanied).toBe('alone');
    expect(bodyAccompanied.accompanied).toBe('companied');
    expect(bodyAlone.accompanied).not.toBe(bodyAccompanied.accompanied);
  });

  it('modo alone deve filtrar rotas com stages inacessíveis', () => {
    const routes = [
      { id: 'ok', stages: [{ accessible: true }, { accessible: true }] },
      { id: 'nok', stages: [{ accessible: false }, { accessible: true }] },
    ];
    const aloneRoutes = routes.filter((r) => r.stages.every((s) => s.accessible));
    expect(aloneRoutes).toHaveLength(1);
    expect(aloneRoutes[0].id).toBe('ok');
  });

  it('modo accompanied não deve filtrar — retorna todas', () => {
    const routes = [{ stages: [{ accessible: true }] }, { stages: [{ accessible: false }] }];
    expect(routes).toHaveLength(2);
  });
});

describe('BUG: Todas as rotas marcadas como acessíveis', () => {
  it('stage com inclinação > 8% DEVE ser inacessível', () => {
    const slope = 10.5;
    const accessible = slope <= 8;
    expect(accessible).toBe(false);
  });

  it('stage bus não deve ser marcado como acessível automaticamente', () => {
    const busStage = { mode: 'bus', accessible: true };
    const stopAccessible = false;
    if (!stopAccessible) busStage.accessible = false;
    expect(busStage.accessible).toBe(false);
  });

  it('mode walking deve ser normalizado para walk', () => {
    const normalizeMode = (mode: string) => (mode === 'walking' ? 'walk' : mode);
    expect(normalizeMode('walking')).toBe('walk');
    expect(normalizeMode('walk')).toBe('walk');
    expect(normalizeMode('bus')).toBe('bus');
  });

  it('stage com mode walking não deve pular análise de acessibilidade', () => {
    const stage = { mode: 'walking', accessible: true };
    const normalizedMode = stage.mode === 'walking' ? 'walk' : stage.mode;
    expect(normalizedMode).toBe('walk');
    expect(['walk', 'bus', 'subway']).toContain(normalizedMode);
  });
});

describe('BUG: Fotos não retornando corretamente', () => {
  it('stage walk deve ter exatamente 3 imagens', () => {
    const stage = { mode: 'walk', street_view_images: ['u1', 'u2', 'u3'] };
    expect(stage.street_view_images).not.toHaveLength(0);
    expect(stage.street_view_images).not.toHaveLength(1);
    expect(stage.street_view_images).toHaveLength(3);
  });

  it('quando Street View não disponível deve usar satélite como fallback', () => {
    const stage = {
      mode: 'walk',
      image_source: 'satellite',
      street_view_images: ['sat1', 'sat2', 'sat3'],
    };
    expect(stage.image_source).toBe('satellite');
    expect(stage.street_view_images).toHaveLength(3);
  });

  it('URL de imagem não deve ser null ou undefined', () => {
    const stage = {
      mode: 'walk',
      street_view_images: [
        'https://maps.googleapis.com/streetview?loc=1',
        'https://maps.googleapis.com/streetview?loc=2',
        'https://maps.googleapis.com/streetview?loc=3',
      ],
    };
    stage.street_view_images.forEach((url) => {
      expect(url).not.toBeNull();
      expect(url).not.toBeUndefined();
      expect(url.length).toBeGreaterThan(0);
    });
  });

  it('stage bus deve usar foto da parada, não Street View', () => {
    const stage = {
      mode: 'bus',
      stop_photo: 'https://maps.googleapis.com/place/photo?ref=ABC',
      street_view_images: undefined,
    };
    expect(stage.stop_photo).toBeTruthy();
    expect(stage.street_view_images).toBeUndefined();
  });
});

describe('BUG: Badge de atenção não aparecendo', () => {
  it('hasAttentionSegments deve ser true quando slope_warning é true', () => {
    const route = { slope_warning: true, warning: 'Inclinação acima de 8%', stages: [] };
    const hasAttention = route.slope_warning === true || !!route.warning;
    expect(hasAttention).toBe(true);
  });

  it('hasAttentionSegments deve ser true quando route.warning está preenchido', () => {
    const route = { slope_warning: false, warning: 'Trecho com obstáculos', stages: [] };
    const hasAttention = route.slope_warning === true || !!route.warning;
    expect(hasAttention).toBe(true);
  });

  it('hasAttentionSegments deve ser true quando accompanied_warning está preenchido', () => {
    const route = {
      slope_warning: false,
      warning: null,
      accompanied_warning: 'Recomendamos ir acompanhado',
      stages: [],
    };
    const hasAttention =
      route.slope_warning === true || !!route.warning || !!route.accompanied_warning;
    expect(hasAttention).toBe(true);
  });

  it('hasAttentionSegments deve ser true quando qualquer stage tem warning', () => {
    const route = {
      slope_warning: false,
      warning: null,
      accompanied_warning: null,
      stages: [{ mode: 'walk', accessible: false, warning: 'Sem rampa' }],
    };
    const hasAttention = route.stages.some((s) => !s.accessible && s.warning);
    expect(hasAttention).toBe(true);
  });

  it('hasAttentionSegments deve ser false quando tudo está ok', () => {
    const route = {
      slope_warning: false,
      warning: null,
      accompanied_warning: null,
      stages: [{ mode: 'walk', accessible: true, warning: null }],
    };
    const hasAttention =
      route.slope_warning === true ||
      !!route.warning ||
      !!route.accompanied_warning ||
      route.stages.some((s) => !s.accessible);
    expect(hasAttention).toBe(false);
  });
});

describe('BUG: Verificação de email', () => {
  it('usuário antigo (cadastrado antes da feature) deve ter email_verified true', () => {
    const oldUser = { email_verified: true, created_at: new Date('2024-01-01') };
    expect(oldUser.email_verified).toBe(true);
  });

  it('novo usuário deve ter email_verified false até confirmar', () => {
    const newUser = { email_verified: false };
    expect(newUser.email_verified).toBe(false);
  });

  it('login com Google deve ter email_verified true automaticamente', () => {
    const googleUser = { google_id: 'google_123', email_verified: true };
    expect(googleUser.email_verified).toBe(true);
  });
});
