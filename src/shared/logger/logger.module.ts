import { Module, Global } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { pinoConfig } from './pino.config';

@Global() // Torna o logger disponível em toda aplicação sem precisar importar
@Module({
  imports: [PinoLoggerModule.forRoot(pinoConfig)],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}