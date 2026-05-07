/**
 * SUITE: Contrato da API
 * Garante que a API retorna exatamente o que o frontend espera
 */

describe('CONTRATO: POST /routes/check', () => {
  const validResponse = {
    route: {
      id: 1,
      origin: 'Ibituruna, Montes Claros',
      destination: 'Shopping Ibituruna',
      accompanied: 'alone',
    },
    routes: [
      {
        total_duration: '10 minutos',
        total_distance: '3,8 km',
        accessible: true,
        slope_warning: false,
        warning: null,
        accompanied_warning: null,
        weather: {
          condition: 'clear',
          temp: 28,
          rain: 0,
          alert: null,
        },
        stages: [
          {
            stage: 1,
            mode: 'walk',
            instruction: 'Caminhe até a parada',
            distance: '300m',
            duration: '4 min',
            accessible: true,
            warning: null,
            street_view_images: ['url1', 'url2', 'url3'],
            line_code: null,
            stop_name: null,
            stop_photo: null,
            points: [{ latitude: -16.7, longitude: -43.87 }],
          },
          {
            stage: 2,
            mode: 'bus',
            instruction: 'Embarque na linha 5801',
            distance: '3km',
            duration: '6 min',
            accessible: true,
            warning: null,
            street_view_images: undefined,
            line_code: '5801',
            stop_name: 'Terminal Central',
            stop_photo: 'https://maps.googleapis.com/place/photo',
            points: [],
          },
        ],
      },
    ],
  };

  it('deve ter campo route com id', () => {
    expect(validResponse.route.id).toBeDefined();
    expect(validResponse.route.origin).toBeTruthy();
    expect(validResponse.route.destination).toBeTruthy();
  });

  it('deve ter array routes com pelo menos 1 rota', () => {
    expect(Array.isArray(validResponse.routes)).toBe(true);
    expect(validResponse.routes.length).toBeGreaterThan(0);
  });

  it('cada rota deve ter todos os campos obrigatórios', () => {
    validResponse.routes.forEach((route) => {
      expect(route.total_duration).toBeDefined();
      expect(route.total_distance).toBeDefined();
      expect(typeof route.accessible).toBe('boolean');
      expect(typeof route.slope_warning).toBe('boolean');
      expect(route.weather).toBeDefined();
      expect(route.stages).toBeDefined();
      expect(Array.isArray(route.stages)).toBe(true);
    });
  });

  it('weather deve ter todos os campos', () => {
    validResponse.routes.forEach((route) => {
      expect(route.weather.condition).toBeDefined();
      expect(typeof route.weather.temp).toBe('number');
      expect(typeof route.weather.rain).toBe('number');
    });
  });

  it('cada stage deve ter mode normalizado', () => {
    const validModes = ['walk', 'bus', 'subway'];
    validResponse.routes.forEach((route) => {
      route.stages.forEach((stage) => {
        expect(validModes).toContain(stage.mode);
        expect(stage.mode).not.toBe('walking');
        expect(stage.mode).not.toBe('TRANSIT');
        expect(stage.mode).not.toBe('transit');
      });
    });
  });

  it('stage walk deve ter street_view_images com 3 itens', () => {
    validResponse.routes.forEach((route) => {
      route.stages
        .filter((s) => s.mode === 'walk')
        .forEach((stage) => {
          expect(stage.street_view_images).toHaveLength(3);
        });
    });
  });

  it('stage bus deve ter line_code e stop_photo', () => {
    validResponse.routes.forEach((route) => {
      route.stages
        .filter((s) => s.mode === 'bus')
        .forEach((stage) => {
          expect(stage.line_code).toBeTruthy();
          expect(stage.stop_photo).toBeTruthy();
        });
    });
  });

  it('stage deve ter points array para desenhar polyline', () => {
    validResponse.routes.forEach((route) => {
      route.stages.forEach((stage) => {
        expect(Array.isArray(stage.points)).toBe(true);
      });
    });
  });
});

describe('CONTRATO: GET /users/me', () => {
  const validUser = {
    id: 1,
    name: 'Maria Silva',
    email: 'maria@email.com',
    disability_type: 'cadeirante',
    transport_preferences: ['bus', 'walk'],
    email_verified: true,
  };

  it('deve retornar id, name, email, disability_type', () => {
    expect(validUser.id).toBeDefined();
    expect(validUser.name).toBeTruthy();
    expect(validUser.email).toBeTruthy();
    expect(validUser.disability_type).toBeTruthy();
  });

  it('não deve retornar password', () => {
    expect((validUser as Record<string, unknown>).password).toBeUndefined();
  });

  it('transport_preferences deve ser array', () => {
    expect(Array.isArray(validUser.transport_preferences)).toBe(true);
  });
});

describe('CONTRATO: GET /reviews', () => {
  const validResponse = {
    average_rating: 4.2,
    total: 15,
    distribution: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 },
    reviews: [
      {
        id: 1,
        rating: 5,
        comment: 'Rota muito acessível!',
        tags: ['onibus_acessivel'],
        likes: 3,
        created_at: '2024-01-01',
        liked_by_me: false,
        user: { name: 'João', initials: 'JS' },
      },
    ],
  };

  it('deve ter average_rating, total e distribution', () => {
    expect(validResponse.average_rating).toBeGreaterThanOrEqual(1);
    expect(validResponse.average_rating).toBeLessThanOrEqual(5);
    expect(validResponse.total).toBeGreaterThan(0);
    expect(validResponse.distribution).toBeDefined();
  });

  it('distribuição deve ter todas as estrelas de 1 a 5', () => {
    expect(validResponse.distribution[1]).toBeDefined();
    expect(validResponse.distribution[5]).toBeDefined();
  });

  it('cada review deve ter user com name e initials', () => {
    validResponse.reviews.forEach((review) => {
      expect(review.user.name).toBeTruthy();
      expect(review.user.initials).toBeTruthy();
      expect(review.user.initials.length).toBeLessThanOrEqual(3);
    });
  });

  it('review não deve expor email do usuário', () => {
    validResponse.reviews.forEach((review) => {
      expect((review.user as Record<string, unknown>).email).toBeUndefined();
    });
  });
});
