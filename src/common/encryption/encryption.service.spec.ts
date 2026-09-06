import { EncryptionService } from './encryption.service';
import { ConfigService } from '@nestjs/config';

// Arrange compartilhado: chave válida de 32 bytes (64 hex chars)
const VALID_KEY = 'a'.repeat(64);

function makeService(key: string = VALID_KEY): EncryptionService {
  const config = { getOrThrow: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  describe('encrypt → decrypt', () => {
    it('retorna o valor original após encrypt e decrypt', () => {
      // Arrange
      const service = makeService();
      const original = 'meu-refresh-token-secreto';

      // Act
      const encrypted = service.encrypt(original);
      const decrypted = service.decrypt(encrypted);

      // Assert
      expect(decrypted).toBe(original);
    });

    it('gera outputs diferentes para o mesmo input (IV aleatório por operação)', () => {
      // Arrange
      const service = makeService();
      const value = 'mesmo-token';

      // Act
      const first = service.encrypt(value);
      const second = service.encrypt(value);

      // Assert — IVs diferentes garantem que o ciphertext nunca se repete
      expect(first).not.toBe(second);
    });

    it('preserva strings com caracteres especiais e unicode', () => {
      // Arrange
      const service = makeService();
      const token = 'AQBxOi6o::token/com+chars=especiais&unicode=🎵';

      // Act
      const result = service.decrypt(service.encrypt(token));

      // Assert
      expect(result).toBe(token);
    });
  });

  describe('decrypt com dados inválidos', () => {
    it('lança erro ao decriptar payload corrompido', () => {
      // Arrange
      const service = makeService();

      // Act + Assert — não pode retornar lixo silenciosamente
      expect(() => service.decrypt('payload:corrompido:invalido')).toThrow();
    });

    it('lança erro ao decriptar string vazia', () => {
      const service = makeService();
      expect(() => service.decrypt('')).toThrow();
    });

    it('lança erro ao decriptar com chave diferente da que encriptou', () => {
      // Arrange — duas instâncias com chaves diferentes
      const serviceA = makeService('a'.repeat(64));
      const serviceB = makeService('b'.repeat(64));
      const encrypted = serviceA.encrypt('token-original');

      // Act + Assert — chave errada não pode decriptar
      expect(() => serviceB.decrypt(encrypted)).toThrow();
    });
  });
});