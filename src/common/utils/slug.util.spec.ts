import { generateSlug, generateSlugWithSuffix } from './slug.util';

describe('generateSlug', () => {
  describe('normalização básica', () => {
    it('converte para lowercase', () => {
      expect(generateSlug('Leonardo')).toBe('leonardo');
    });

    it('substitui espaços por hífens', () => {
      expect(generateSlug('João Silva')).toBe('joao-silva');
    });

    it('remove acentos e caracteres especiais', () => {
      expect(generateSlug('Ângela Müller')).toBe('angela-muller');
    });

    it('remove caracteres não alfanuméricos além de hífens', () => {
      expect(generateSlug('user@email.com')).toBe('useremailcom');
    });

    it('colapsa múltiplos espaços em um único hífen', () => {
      expect(generateSlug('Leo   Silva')).toBe('leo-silva');
    });

    it('remove hífens duplicados', () => {
      expect(generateSlug('Leo--Silva')).toBe('leo-silva');
    });
  });

  describe('casos de borda', () => {
    it('respeita o limite de 32 caracteres', () => {
      const long = 'a'.repeat(50);
      expect(generateSlug(long).length).toBeLessThanOrEqual(32);
    });

    it('remove espaços no início e no fim antes de processar', () => {
      expect(generateSlug('  leonardo  ')).toBe('leonardo');
    });

    it('lida com nome apenas de caracteres especiais', () => {
      const result = generateSlug('!!!');
      expect(typeof result).toBe('string');
      // não lança — retorna string vazia ou processada
    });
  });
});

describe('generateSlugWithSuffix', () => {
  it('adiciona sufixo numérico ao slug base', () => {
    expect(generateSlugWithSuffix('leonardo', 2)).toBe('leonardo-2');
  });

  it('garante que o resultado final não ultrapassa 32 caracteres', () => {
    const long = 'a'.repeat(30);
    const result = generateSlugWithSuffix(long, 99);
    expect(result.length).toBeLessThanOrEqual(32);
  });

  it('sufixos diferentes geram slugs diferentes', () => {
    const base = 'leonardo';
    expect(generateSlugWithSuffix(base, 2)).not.toBe(generateSlugWithSuffix(base, 3));
  });
});