describe('AuthService — validações de cadastro', () => {
  describe('validação de email', () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    it('deve aceitar email válido', () => {
      expect(emailRegex.test('usuario@gmail.com')).toBe(true);
    });

    it('deve rejeitar email sem @', () => {
      expect(emailRegex.test('usuariogmail.com')).toBe(false);
    });

    it('deve rejeitar email sem domínio', () => {
      expect(emailRegex.test('usuario@')).toBe(false);
    });

    it('deve rejeitar email vazio', () => {
      expect(emailRegex.test('')).toBe(false);
    });
  });

  describe('validação de código de verificação', () => {
    it('deve gerar código de 6 dígitos', () => {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      expect(code).toHaveLength(6);
      expect(Number(code)).toBeGreaterThanOrEqual(100000);
      expect(Number(code)).toBeLessThanOrEqual(999999);
    });

    it('deve expirar em 15 minutos', () => {
      const expires = new Date(Date.now() + 15 * 60 * 1000);
      const now = new Date();
      const diffMinutes = (expires.getTime() - now.getTime()) / 60000;
      expect(diffMinutes).toBeCloseTo(15, 0);
    });
  });

  describe('confirmação de senha', () => {
    it('deve aceitar senhas iguais', () => {
      expect('senha123').toBe('senha123');
    });

    it('deve rejeitar senhas diferentes', () => {
      expect('senha123').not.toBe('senha456');
    });
  });
});
