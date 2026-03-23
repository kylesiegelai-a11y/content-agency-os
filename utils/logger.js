const winston = require('winston');
const path = require('path');
const fs = require('fs');

const isTestEnv = process.env.NODE_ENV === 'test';

const logsDir = './logs';
if (!isTestEnv && !fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (stack) {
      log += `\n${stack}`;
    }
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    return log;
  })
);

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    format
  ),
  level: process.env.LOG_LEVEL || 'info'
});

// Build transport list — skip file transports in test environment
// to avoid holding open file handles that prevent Jest from exiting cleanly
const transports = [consoleTransport];

if (!isTestEnv) {
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      format: format,
      maxsize: 5242880,
      maxFiles: 5,
      level: process.env.LOG_LEVEL || 'info'
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      format: format,
      maxsize: 5242880,
      maxFiles: 5,
      level: 'error'
    })
  );
}

const logger = winston.createLogger({
  levels: logLevels,
  transports
});

module.exports = {
  logger,
  default: logger,
  info: (msg, meta) => logger.info(msg, meta),
  warn: (msg, meta) => logger.warn(msg, meta),
  error: (msg, err) => logger.error(msg, { error: err?.message || err }),
  debug: (msg, meta) => logger.debug(msg, meta),
  audit: (action, userId, details) => {
    logger.info(`AUDIT: ${action}`, {
      userId,
      timestamp: new Date().toISOString(),
      ...details
    });
  }
};
