import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // Segura os logs até o Pino estar pronto
  });
  app.useLogger(app.get(Logger));

  // Helmet — headers de segurança HTTP
  app.use(helmet());

  // Cookie parser
  app.use(cookieParser());

  // Prefixo global
  app.setGlobalPrefix('api');

  // Validação global de DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,    // remove campos não declarados no DTO
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // CORS
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      process.env.FRONTEND_URL, // URL de produção
    ].filter(Boolean),
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();