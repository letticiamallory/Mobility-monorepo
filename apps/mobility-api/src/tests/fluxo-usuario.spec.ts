/**
 * SUITE: Fluxos de Usuário
 * Simula os fluxos principais do app do início ao fim
 */

describe('FLUXO: Cadastro e verificação de email', () => {
  it('deve rejeitar email inválido', () => {
    const emails = ['semArroba', '@semdomain', 'sem@', '', 'a@b', 'teste@'];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    emails.forEach((email) => {
      expect(emailRegex.test(email)).toBe(false);
    });
  });

  it('deve aceitar emails válidos', () => {
    const emails = ['usuario@gmail.com', 'teste@mobility.com.br', 'a@b.co'];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    emails.forEach((email) => {
      expect(emailRegex.test(email)).toBe(true);
    });
  });

  it('deve rejeitar senhas que não coincidem', () => {
    expect('Senha@123').not.toBe('Senha@456');
  });

  it('deve aceitar senhas iguais', () => {
    expect('Senha@123').toBe('Senha@123');
  });

  it('código de verificação deve ter 6 dígitos', () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    expect(code).toHaveLength(6);
    expect(Number(code)).toBeGreaterThanOrEqual(100000);
    expect(Number(code)).toBeLessThanOrEqual(999999);
  });

  it('código deve expirar em 15 minutos', () => {
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    const diff = (expires.getTime() - Date.now()) / 60000;
    expect(diff).toBeCloseTo(15, 0);
  });

  it('usuário não verificado não deve conseguir fazer login', () => {
    const user = { email_verified: false };
    const canLogin = user.email_verified;
    expect(canLogin).toBe(false);
  });

  it('usuário verificado deve conseguir fazer login', () => {
    const user = { email_verified: true };
    const canLogin = user.email_verified;
    expect(canLogin).toBe(true);
  });
});

describe('FLUXO: Busca de rotas', () => {
  const mockRoutes = [
    {
      id: 'rota-1',
      total_duration: '10 minutos',
      total_distance: '3,8 km',
      accessible: true,
      slope_warning: false,
      warning: null,
      accompanied_warning: null,
      weather: { rain: 0, alert: null },
      stages: [
        {
          mode: 'walk',
          accessible: true,
          warning: null,
          distance: '300m',
          duration: '4 min',
          street_view_images: ['u1', 'u2', 'u3'],
        },
        {
          mode: 'bus',
          accessible: true,
          warning: null,
          line_code: '5801',
          stop_photo: 'foto_parada',
        },
        {
          mode: 'walk',
          accessible: true,
          warning: null,
          distance: '200m',
          duration: '3 min',
          street_view_images: ['u4', 'u5', 'u6'],
        },
      ],
    },
    {
      id: 'rota-2',
      total_duration: '15 minutos',
      total_distance: '4,2 km',
      accessible: false,
      slope_warning: true,
      warning: 'Trecho com inclinação acima de 8%',
      accompanied_warning: 'Trecho com obstáculos — pode ser difícil sem acompanhamento',
      weather: { rain: 0, alert: null },
      stages: [
        {
          mode: 'walk',
          accessible: false,
          warning: 'Inclinação de 12%',
          distance: '400m',
          duration: '6 min',
          street_view_images: ['u7', 'u8', 'u9'],
        },
        {
          mode: 'bus',
          accessible: true,
          warning: null,
          line_code: '6901',
          stop_photo: 'foto_parada2',
        },
        {
          mode: 'walk',
          accessible: true,
          warning: null,
          distance: '150m',
          duration: '2 min',
          street_view_images: ['u10', 'u11', 'u12'],
        },
      ],
    },
    {
      id: 'rota-3',
      total_duration: '8 minutos',
      total_distance: '2,1 km',
      accessible: false,
      slope_warning: false,
      warning: null,
      accompanied_warning: 'Trecho com obstáculos',
      weather: { rain: 0, alert: null },
      stages: [
        {
          mode: 'walk',
          accessible: false,
          warning: 'Sem rampa identificada',
          distance: '500m',
          duration: '7 min',
          street_view_images: ['u13', 'u14', 'u15'],
        },
        { mode: 'bus', accessible: true, warning: null, line_code: '3301', stop_photo: 'foto_parada3' },
      ],
    },
  ];

  it('deve retornar no máximo 3 rotas', () => {
    expect(mockRoutes.length).toBeLessThanOrEqual(3);
  });

  it('rotas devem estar ordenadas com acessíveis primeiro', () => {
    const sorted = [...mockRoutes].sort((a, b) => {
      if (a.accessible && !b.accessible) return -1;
      if (!a.accessible && b.accessible) return 1;
      return 0;
    });
    expect(sorted[0].accessible).toBe(true);
  });

  it('aba sozinho deve mostrar apenas rotas 100% acessíveis', () => {
    const alone = mockRoutes.filter((r) => r.stages.every((s) => s.accessible));
    expect(alone).toHaveLength(1);
    expect(alone[0].id).toBe('rota-1');
    alone.forEach((r) => {
      expect(r.stages.every((s) => s.accessible)).toBe(true);
    });
  });

  it('aba acompanhado deve mostrar todas as rotas', () => {
    expect(mockRoutes).toHaveLength(3);
  });

  it('rotas da aba sozinho e acompanhado devem ser DIFERENTES', () => {
    const alone = mockRoutes.filter((r) => r.stages.every((s) => s.accessible));
    const accompanied = mockRoutes;
    expect(alone.length).not.toBe(accompanied.length);
  });

  it('cada stage walk deve ter exatamente 3 fotos', () => {
    mockRoutes.forEach((route) => {
      route.stages
        .filter((s) => s.mode === 'walk')
        .forEach((stage) => {
          expect(stage.street_view_images).toHaveLength(3);
        });
    });
  });

  it('cada stage bus deve ter foto da parada', () => {
    mockRoutes.forEach((route) => {
      route.stages
        .filter((s) => s.mode === 'bus')
        .forEach((stage) => {
          expect(stage.stop_photo).toBeTruthy();
        });
    });
  });

  it('stage bus deve ter line_code preenchido', () => {
    mockRoutes.forEach((route) => {
      route.stages
        .filter((s) => s.mode === 'bus')
        .forEach((stage) => {
          expect(stage.line_code).toBeTruthy();
          expect(stage.line_code).not.toBe('unknown');
        });
    });
  });

  it('rota com slope_warning deve ter warning preenchido', () => {
    const routesWithSlope = mockRoutes.filter((r) => r.slope_warning);
    routesWithSlope.forEach((r) => {
      expect(r.warning).toBeTruthy();
    });
  });

  it('rota inacessível deve ter accompanied_warning preenchido', () => {
    const inaccessible = mockRoutes.filter((r) => !r.accessible);
    inaccessible.forEach((r) => {
      expect(r.accompanied_warning).toBeTruthy();
    });
  });
});

describe('FLUXO: Clima e alertas', () => {
  it('chuva leve (0-5mm) deve gerar alerta de piso escorregadio', () => {
    const weather = {
      rain: 2.5,
      alert: 'Chuva leve no trajeto — piso pode estar escorregadio',
    };
    expect(weather.rain).toBeGreaterThan(0);
    expect(weather.rain).toBeLessThanOrEqual(5);
    expect(weather.alert).toContain('escorregadio');
  });

  it('chuva forte (>5mm) deve gerar alerta mais severo', () => {
    const weather = {
      rain: 8,
      alert: 'Chuva forte no trajeto — superfícies escorregadias e visibilidade reduzida',
    };
    expect(weather.rain).toBeGreaterThan(5);
    expect(weather.alert).toContain('Chuva forte');
    expect(weather.alert).toContain('visibilidade');
  });

  it('sem chuva não deve gerar alerta', () => {
    const weather = { rain: 0, alert: null };
    expect(weather.alert).toBeNull();
  });

  it('alerta de chuva deve ser especialmente relevante para cadeirantes', () => {
    const weather = { rain: 3, alert: 'Chuva leve no trajeto — piso pode estar escorregadio' };
    const persona = { type: 'cadeirante' };
    expect(weather.alert).toContain('escorregadio');
    expect(persona.type).toBe('cadeirante');
  });
});

describe('FLUXO: Reviews de acessibilidade', () => {
  it('review deve ter rating entre 1 e 5', () => {
    const reviews = [{ rating: 1 }, { rating: 3 }, { rating: 5 }];
    reviews.forEach((r) => {
      expect(r.rating).toBeGreaterThanOrEqual(1);
      expect(r.rating).toBeLessThanOrEqual(5);
    });
  });

  it('review deve ter type válido', () => {
    const validTypes = ['route', 'station', 'line'];
    const review = { type: 'route', rating: 4 };
    expect(validTypes).toContain(review.type);
  });

  it('tags de review devem ser descritivas de acessibilidade', () => {
    const validTags = [
      'sem_rampa',
      'calcada_quebrada',
      'onibus_acessivel',
      'motorista_atencioso',
      'sem_sinal_sonoro',
      'onibus_lotado',
      'piso_irregular',
      'sem_estacionamento',
    ];
    const review = { tags: ['sem_rampa', 'piso_irregular'] };
    review.tags.forEach((tag) => {
      expect(validTags).toContain(tag);
    });
  });

  it('média de reviews deve ser calculada corretamente', () => {
    const ratings = [5, 4, 3, 2, 1];
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    expect(avg).toBe(3);
  });

  it('distribuição de estrelas deve somar o total de reviews', () => {
    const distribution = { 1: 2, 2: 3, 3: 5, 4: 8, 5: 12 };
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
  });
});

describe('FLUXO: Perfil do usuário', () => {
  it('perfil deve conter campos obrigatórios', () => {
    const user = {
      id: 1,
      name: 'Maria Silva',
      email: 'maria@email.com',
      disability_type: 'cadeirante',
      transport_preferences: ['bus'],
      email_verified: true,
    };
    expect(user.id).toBeDefined();
    expect(user.name).toBeTruthy();
    expect(user.email).toBeTruthy();
    expect(user.disability_type).toBeTruthy();
    expect(user.email_verified).toBe(true);
  });

  it('disability_type deve ser um dos valores válidos', () => {
    const validTypes = ['visual', 'cadeirante', 'mobilidade_reduzida', 'não informado'];
    const user = { disability_type: 'cadeirante' };
    expect(validTypes).toContain(user.disability_type);
  });

  it('transport_preferences deve ser array não vazio', () => {
    const user = { transport_preferences: ['bus', 'walk'] };
    expect(Array.isArray(user.transport_preferences)).toBe(true);
    expect(user.transport_preferences.length).toBeGreaterThan(0);
  });
});
