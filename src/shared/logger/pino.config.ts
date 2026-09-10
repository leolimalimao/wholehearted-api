import { Params } from 'nestjs-pino';
import * as path from 'path';

const LOG_DIR = '/var/log/wholehearted-stats';
const LOG_FILE = path.join(LOG_DIR, 'app.log');

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

export const pinoConfig: Params = {
  pinoHttp: {
    level: logLevel,

    // Gera requestId automático para cada request HTTP
    genReqId: (req) => {
      return req.headers['x-request-id'] ?? crypto.randomUUID();
    },

    // Define o que aparece no log de cada request/response
    serializers: {
      req(req) {
        return {
          requestId: req.id,
          method: req.method,
          url: req.url,
          userId: req.raw?.userId ?? undefined,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },

    // Em dev: pretty print colorido no terminal
    // Em produção: JSON puro no stdout
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : {
          targets: [
            // Stdout JSON (Railway captura isso)
            {
              target: 'pino/file',
              level: logLevel,
              options: { destination: 1 }, // 1 = stdout
            },
            // Arquivo local
            {
              target: 'pino/file',
              level: logLevel,
              options: {
                destination: LOG_FILE,
                mkdir: true, // Cria o diretório se não existir
              },
            },
          ],
        },
  },
};