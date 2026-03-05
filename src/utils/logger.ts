import winston from 'winston';
import { resolve } from 'node:path';

const LOG_DIR = resolve('logs');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }),
);

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat,
      ),
    }),
    new winston.transports.File({
      filename: resolve(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5_000_000,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: resolve(LOG_DIR, 'combined.log'),
      maxsize: 10_000_000,
      maxFiles: 10,
    }),
  ],
});
