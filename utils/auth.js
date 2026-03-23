const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logger = require('./logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h';

class AuthManager {
  static async hashPassword(password) {
    try {
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(password, salt);
      logger.info('Password hashed successfully');
      return hashed;
    } catch (err) {
      logger.error('Error hashing password', err);
      throw err;
    }
  }

  static async verifyPassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (err) {
      logger.error('Error verifying password', err);
      throw err;
    }
  }

  static generateToken(userId, metadata = {}) {
    try {
      const payload = {
        userId,
        ...metadata,
        iat: Math.floor(Date.now() / 1000),
        type: 'access'
      };
      const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRATION
      });
      logger.debug(`Generated JWT token for user ${userId}`);
      return token;
    } catch (err) {
      logger.error('Error generating JWT token', err);
      throw err;
    }
  }

  static verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      logger.warn('Invalid token');
      throw new Error('Invalid token');
    }
  }

  static validatePasswordStrength(password) {
    const errors = [];
    const minLength = 12;

    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};:'",.<>?/\\|` + '`' + '~]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static createSession(userId, metadata = {}) {
    const accessToken = this.generateToken(userId, metadata);
    return {
      userId,
      accessToken,
      createdAt: new Date().toISOString(),
      metadata
    };
  }

  static extractToken(authHeader) {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return null;
    }
    return parts[1];
  }
}

const authMiddleware = (req, res, next) => {
  try {
    const token = AuthManager.extractToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = AuthManager.verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('Authentication failed', err.message);
    return res.status(401).json({ error: 'Unauthorized: ' + err.message });
  }
};

const optionalAuthMiddleware = (req, res, next) => {
  try {
    const token = AuthManager.extractToken(req.headers.authorization);
    if (token) {
      const decoded = AuthManager.verifyToken(token);
      req.user = decoded;
    }
    next();
  } catch (err) {
    logger.debug('Optional authentication skipped', err.message);
    next();
  }
};

module.exports = {
  AuthManager,
  authMiddleware,
  optionalAuthMiddleware
};
