import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(
    private config: ConfigService,
    @Optional()
    @InjectPinoLogger(EncryptionService.name)
    private readonly logger?: PinoLogger,
  ) {
    const hexKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    this.key = Buffer.from(hexKey, 'hex'); // precisa ter 32 bytes (64 hex chars)
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // formato: iv:authTag:encrypted (tudo em hex)
    return [iv, authTag, encrypted].map((b) => b.toString('hex')).join(':');
  }

  decrypt(payload: string): string {
    try {
      const parts = payload.split(':');
      if (parts.length !== 3) {
        throw new Error('Payload em formato inválido. Esperado iv:authTag:encrypted');
      }

      const [ivHex, authTagHex, encryptedHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (err: any) {
      this.logger?.error(
        { err, message: err?.message },
        'Falha ao decriptar payload AES-256-GCM. Dados corrompidos ou chave ENCRYPTION_KEY divergente.',
      );
      throw err;
    }
  }
}