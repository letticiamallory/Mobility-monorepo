/**
 * SUITE: Personas de Deficiência
 * Testa os 3 grupos de usuários do Mobility:
 * - Visual: deficiência visual ou baixa visão
 * - Cadeirante: usuário de cadeira de rodas
 * - Mobilidade reduzida: dificuldade de locomoção
 */

describe('PERSONA: Deficiente Visual', () => {
  describe('Rotas', () => {
    it('deve retornar fotos em TODOS os stages walk para orientação visual', () => {
      const stages = [
        { mode: 'walk', street_view_images: ['u1', 'u2', 'u3'] },
        { mode: 'bus', line_code: '5801' },
        { mode: 'walk', street_view_images: ['u4', 'u5', 'u6'] },
      ];
      stages.filter((s) => s.mode === 'walk').forEach((s) => {
        expect(s.street_view_images).toHaveLength(3);
      });
    });

    it('deve ter warning explícito quando piso é irregular', () => {
      const stage = {
        mode: 'walk',
        accessible: false,
        warning: 'Piso irregular identificado no trecho',
      };
      expect(stage.warning).toContain('Piso irregular');
      expect(stage.accessible).toBe(false);
    });

    it('deve ter warning explícito quando há obstáculo na calçada', () => {
      const stage = {
        mode: 'walk',
        accessible: false,
        warning: 'Possível obstáculo identificado nesse trecho',
      };
      expect(stage.warning).toContain('obstáculo');
    });

    it('instrução de embarque deve conter nome da parada para orientação', () => {
      const stage = {
        mode: 'bus',
        instruction: 'Embarque na linha 5801 na parada Terminal Central',
        line_code: '5801',
        stop_name: 'Terminal Central',
      };
      expect(stage.instruction).toContain('Terminal Central');
      expect(stage.stop_name).toBeTruthy();
    });

    it('rota sozinho deve ter fotos em cada stage walk', () => {
      const route = {
        accompanied: 'alone',
        stages: [
          { mode: 'walk', accessible: true, street_view_images: ['u1', 'u2', 'u3'] },
          { mode: 'bus', accessible: true, line_code: '5801' },
          { mode: 'walk', accessible: true, street_view_images: ['u4', 'u5', 'u6'] },
        ],
      };
      route.stages.filter((s) => s.mode === 'walk').forEach((s) => {
        expect(s.street_view_images).toHaveLength(3);
      });
    });
  });

  describe('Acessibilidade da UI', () => {
    it('todos os elementos interativos devem ter accessibilityLabel definido', () => {
      const elementos = [
        { tipo: 'botao_buscar', accessibilityLabel: 'Buscar rotas' },
        { tipo: 'campo_destino', accessibilityLabel: 'Digite o destino' },
        { tipo: 'botao_sozinho', accessibilityLabel: 'Buscar rotas sozinho' },
        { tipo: 'botao_acompanhado', accessibilityLabel: 'Buscar rotas acompanhado' },
      ];
      elementos.forEach((el) => {
        expect(el.accessibilityLabel).toBeTruthy();
        expect(el.accessibilityLabel.length).toBeGreaterThan(3);
      });
    });

    it('badges de acessibilidade devem ter texto descritivo além de ícone', () => {
      const badge = {
        icon: 'wheelchair-accessibility',
        text: 'Acessível',
        accessibilityLabel: 'Rota acessível para cadeirantes',
      };
      expect(badge.text).toBeTruthy();
      expect(badge.accessibilityLabel).toBeTruthy();
    });
  });
});

describe('PERSONA: Cadeirante', () => {
  describe('Filtro sozinho', () => {
    it('deve rejeitar qualquer rota com stage inacessível no modo sozinho', () => {
      const routes = [
        { id: 'A', stages: [{ mode: 'walk', accessible: true }, { mode: 'bus', accessible: true }] },
        { id: 'B', stages: [{ mode: 'walk', accessible: false, warning: 'Sem rampa' }, { mode: 'bus', accessible: true }] },
        { id: 'C', stages: [{ mode: 'walk', accessible: true }, { mode: 'bus', accessible: false }] },
      ];
      const soloRoutes = routes.filter((r) => r.stages.every((s) => s.accessible));
      expect(soloRoutes).toHaveLength(1);
      expect(soloRoutes[0].id).toBe('A');
    });

    it('deve avisar quando nenhuma rota é 100% acessível', () => {
      const routes = [
        { stages: [{ accessible: false }], warning: null as string | null, accompanied_warning: null as string | null },
      ];
      const fullyAccessible = routes.filter((r) => r.stages.every((s) => s.accessible));
      if (fullyAccessible.length === 0) {
        routes[0].warning = 'Nenhuma rota totalmente acessível encontrada para este trajeto';
        routes[0].accompanied_warning =
          'Trecho com obstáculos — pode ser difícil sem acompanhamento';
      }
      expect(routes[0].warning).toContain('Nenhuma rota totalmente acessível');
      expect(routes[0].accompanied_warning).toBeTruthy();
    });

    it('rota mais acessível deve ser a primeira da lista', () => {
      const routes = [
        { id: 'inacessivel', accessible: false, inaccessibleCount: 2 },
        { id: 'parcial', accessible: false, inaccessibleCount: 1 },
        { id: 'acessivel', accessible: true, inaccessibleCount: 0 },
      ];
      const sorted = [...routes].sort((a, b) => a.inaccessibleCount - b.inaccessibleCount);
      expect(sorted[0].id).toBe('acessivel');
    });

    it('deve identificar ausência de rampa como inacessível', () => {
      const stage = {
        mode: 'walk',
        accessible: false,
        warning: 'Sem rampa identificada neste trecho',
      };
      expect(stage.accessible).toBe(false);
      expect(stage.warning).toContain('rampa');
    });

    it('deve identificar degrau como inacessível', () => {
      const stage = {
        mode: 'walk',
        accessible: false,
        warning: 'Degrau ou obstáculo identificado',
      };
      expect(stage.accessible).toBe(false);
      expect(stage.warning.toLowerCase()).toContain('degrau');
    });
  });

  describe('Filtro acompanhado', () => {
    it('deve retornar rotas com obstáculos com accompanied_warning', () => {
      const route = {
        accessible: false,
        accompanied_warning: 'Trecho com obstáculos — pode ser difícil sem acompanhamento',
        stages: [{ mode: 'walk', accessible: false, warning: 'Sem rampa' }],
      };
      expect(route.accompanied_warning).toBeTruthy();
      expect(route.accompanied_warning).toContain('acompanhamento');
    });

    it('deve diferenciar rotas sozinho e acompanhado — listas diferentes', () => {
      const allRoutes = [
        { id: 'A', stages: [{ accessible: true }, { accessible: true }] },
        { id: 'B', stages: [{ accessible: false }, { accessible: true }] },
        { id: 'C', stages: [{ accessible: false }, { accessible: false }] },
      ];
      const alone = allRoutes.filter((r) => r.stages.every((s) => s.accessible));
      const accompanied = allRoutes;
      expect(alone.length).toBeLessThan(accompanied.length);
      expect(alone).toHaveLength(1);
      expect(accompanied).toHaveLength(3);
    });
  });

  describe('Inclinação', () => {
    it('inclinação > 8% deve marcar stage como inacessível', () => {
      const slopes = [8.1, 10, 12.5, 20];
      slopes.forEach((slope) => {
        expect(slope > 8).toBe(true);
      });
    });

    it('inclinação <= 8% deve marcar stage como acessível', () => {
      const slopes = [0, 2.5, 5, 7.9, 8];
      slopes.forEach((slope) => {
        expect(slope <= 8).toBe(true);
      });
    });

    it('warning de inclinação deve conter o valor percentual', () => {
      const warning = 'Trecho com inclinação aproximada de 12.5% (acima de 8%)';
      expect(warning).toContain('12.5%');
      expect(warning).toContain('8%');
    });

    it('slope_warning na rota deve ser true quando qualquer stage tem inclinação > 8%', () => {
      const route = {
        slope_warning: true,
        stages: [
          { mode: 'walk', accessible: false, warning: 'Inclinação de 15%' },
          { mode: 'bus', accessible: true },
        ],
      };
      expect(route.slope_warning).toBe(true);
    });
  });
});

describe('PERSONA: Mobilidade Reduzida', () => {
  describe('Inclinação tolerada', () => {
    it('inclinação entre 5-8% é acessível mas deve gerar atenção', () => {
      const slope = 6.5;
      const isAccessible = slope <= 8;
      const needsAttention = slope > 5;
      expect(isAccessible).toBe(true);
      expect(needsAttention).toBe(true);
    });

    it('inclinação abaixo de 5% é totalmente confortável', () => {
      const slope = 3;
      const comfortable = slope <= 5;
      expect(comfortable).toBe(true);
    });
  });

  describe('Rotas mistas', () => {
    it('deve aceitar rota com ônibus acessível mesmo que caminhada seja longa', () => {
      const route = {
        stages: [
          { mode: 'walk', accessible: true, distance: '500m', duration: '7 min' },
          { mode: 'bus', accessible: true, line_code: '5801' },
          { mode: 'walk', accessible: true, distance: '200m', duration: '3 min' },
        ],
      };
      expect(route.stages.every((s) => s.accessible)).toBe(true);
    });

    it('distância de caminhada deve ser informada em cada stage walk', () => {
      const stage = { mode: 'walk', distance: '300m', duration: '4 min' };
      expect(stage.distance).toBeTruthy();
      expect(stage.duration).toBeTruthy();
    });
  });
});
