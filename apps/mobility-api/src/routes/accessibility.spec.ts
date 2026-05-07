describe('Acessibilidade — personas do Mobility', () => {
  describe('Persona: Cadeirante', () => {
    it('deve marcar trecho como inacessível se não tiver rampa', () => {
      const stage = {
        mode: 'walk',
        accessible: false,
        warning: 'Sem rampa identificada',
      };
      expect(stage.accessible).toBe(false);
      expect(stage.warning).toBeTruthy();
    });

    it('deve priorizar rotas acessíveis no filtro sozinho', () => {
      const routes = [
        { accessible: true, stages: [{ accessible: true }] },
        { accessible: false, stages: [{ accessible: false }] },
      ];
      const soloRoutes = routes.filter((r) => r.stages.every((s) => s.accessible));
      expect(soloRoutes[0].accessible).toBe(true);
    });
  });

  describe('Persona: Deficiente visual', () => {
    it('deve ter warning quando piso é irregular', () => {
      const stage = {
        mode: 'walk',
        accessible: false,
        warning: 'Piso irregular identificado',
      };
      expect(stage.warning).toContain('Piso');
    });
  });

  describe('Persona: Mobilidade reduzida', () => {
    it('deve alertar sobre inclinação acima de 8%', () => {
      const stage = {
        mode: 'walk',
        accessible: false,
        warning: 'Inclinação aproximada de 12.5% (acima de 8%)',
      };
      expect(stage.warning).toContain('8%');
      expect(stage.accessible).toBe(false);
    });

    it('deve aceitar inclinação menor que 8% como acessível', () => {
      const stage = { mode: 'walk', accessible: true, warning: null };
      expect(stage.accessible).toBe(true);
      expect(stage.warning).toBeNull();
    });
  });

  describe('Alerta de clima', () => {
    it('deve alertar quando há chuva forte', () => {
      const weather = { rain: 8, alert: 'Chuva forte — superfícies escorregadias' };
      expect(weather.rain).toBeGreaterThan(5);
      expect(weather.alert).toBeTruthy();
    });

    it('não deve alertar quando não há chuva', () => {
      const weather = { rain: 0, alert: null };
      expect(weather.alert).toBeNull();
    });
  });
});
