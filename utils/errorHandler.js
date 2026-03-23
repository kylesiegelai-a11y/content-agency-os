const logger = require('./logger');
const storage = require('./storage');

class AppError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.id = require('uuid').v4();
  }
}

class DeadLetterQueue {
  async logError(error, context = {}) {
    const errorEntry = {
      id: error.id || require('uuid').v4(),
      timestamp: error.timestamp || new Date().toISOString(),
      message: error.message,
      statusCode: error.statusCode || 500,
      name: error.name || 'Error',
      stack: error.stack,
      details: error.details || {},
      context: {
        ...context,
        url: context.url || 'N/A',
        method: context.method || 'N/A',
        userId: context.userId || 'N/A'
      }
    };

    try {
      const deadletter = await storage.read('deadletter.json') || { entries: [] };
      if (!Array.isArray(deadletter.entries)) {
        deadletter.entries = [];
      }
      deadletter.entries.push(errorEntry);
      if (deadletter.entries.length > 1000) {
        deadletter.entries = deadletter.entries.slice(-1000);
      }
      await storage.write('deadletter.json', deadletter);
    } catch (storageErr) {
      logger.error('Failed to log to dead letter queue', storageErr);
    }
    return errorEntry;
  }

  async getErrors(limit = 100, filter = {}) {
    try {
      const deadletter = await storage.read('deadletter.json') || { entries: [] };
      let entries = deadletter.entries || [];
      if (filter.statusCode) {
        entries = entries.filter(e => e.statusCode === filter.statusCode);
      }
      return entries.slice(-limit);
    } catch (err) {
      logger.error('Failed to retrieve dead letter entries', err);
      return [];
    }
  }

  async getStats() {
    try {
      const deadletter = await storage.read('deadletter.json') || { entries: [] };
      const entries = deadletter.entries || [];
      const stats = {
        total: entries.length,
        byStatusCode: {},
        byErrorType: {}
      };
      entries.forEach(entry => {
        stats.byStatusCode[entry.statusCode] = (stats.byStatusCode[entry.statusCode] || 0) + 1;
        stats.byErrorType[entry.name] = (stats.byErrorType[entry.name] || 0) + 1;
      });
      return stats;
    } catch (err) {
      logger.error('Failed to get dead letter queue stats', err);
      throw err;
    }
  }
}

const errorHandler = (err, req, res, next) => {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : 'Internal Server Error';

  if (statusCode >= 500) {
    logger.error(message, err);
  } else {
    logger.warn(message, { statusCode });
  }

  const dlq = new DeadLetterQueue();
  dlq.logError(err, {
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id
  }).catch(dlqErr => logger.error('Failed to log to DLQ', dlqErr));

  res.status(statusCode).json({
    error: {
      id: err.id || require('uuid').v4(),
      message: message,
      statusCode: statusCode
    }
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  AppError,
  DeadLetterQueue,
  errorHandler,
  asyncHandler
};
