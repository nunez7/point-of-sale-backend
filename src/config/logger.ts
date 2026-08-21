import { createLogger, format, transports } from 'winston';

const { combine, timestamp, printf, colorize, json } = format;

const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}]: ${message}${metaStr}`;
});

const isDev = process.env.NODE_ENV !== 'production';

export const logger = createLogger({
  level: isDev ? 'debug' : 'info',
  format: isDev
    ? combine(colorize(), timestamp(), devFormat)
    : combine(timestamp(), json()),
  transports: [new transports.Console()],
});