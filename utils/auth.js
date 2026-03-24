/**
 * Auth Manager
 *
 * Hardened authentication for Content Agency OS:
 *   - bcrypt password hashing (salt rounds: 12)
 *   - JWT tokens with configurable expiration
 *   - API key support for programmatic / webhook access
 *   - Password strength validation (12+ chars, upper, number, special)
 *   - JWT secret rotation support via JWT_SECRET_PREVIOUS
 *   - No mock bypass in production mode
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { readData, writeData } = require('./storage');
const logger = require('./logger');

// ── Config ───────────────────────────────────────────────────────────
const MOCK_MODE = process.env.MOCK_MODE === 'true' || process.env.MOCK_MODE === '1';
// In mock mode, generate a random per-process secret instead of a predictable hardcoded value
const JWT_SECRET = process.env.JWT_SECRET || (MOCK_MODE ? crypto.randomBytes(32).toString('hex') : null);
const JWT_SECRET_PREVIOUS = process.env.JWT_SECRET_PREVIOUS || null; // for rotation
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h';
const SALT_ROUNDS = 12;
const API_KEY_PREFIX = 'cao_';  // Content Agency OS prefix
const AUTH_FILE = 'auth.json';

// ── Password ─────────────────────────────────────────────────────────

class AuthManager {
  static async hashPassword(password) {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    return bcrypt.hash(password, salt);
  }

  static async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate password strength.
   * Requires: 12+ chars, 1 uppercase, 1 number, 1 special char.
   */
  static validatePasswordStrength(password) {
    const errors = [];
    if (!password || password.length < 12) {
      errors.push('Password must be at least 12 characters');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Must contain at least one lowercase letter');
    }
    if (!/\d/.test(password)) {
      errors.push('Must contain at least one number');
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
      errors.push('Must contain at least one special character');
    }
    return { isValid: errors.length === 0, errors };
  }

  // ── JWT ──────────────────────────────────────────────────────────

  static generateToken(userId, metadata = {}) {
    if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    const payload = {
      userId,
      ...metadata,
      iat: Math.floor(Date.now() / 1000),
      type: 'access'
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
  }

  /**
   * Verify a JWT token. Supports secret rotation: tries current secret,
   * then falls back to JWT_SECRET_PREVIOUS if set.
   */
  static verifyToken(token) {
    if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // If rotation secret exists, try it
      if (JWT_SECRET_PREVIOUS) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET_PREVIOUS);
          logger.info('[auth] Token verified with previous secret — client should refresh');
          return decoded;
        } catch (_) {
          // Both secrets failed
        }
      }
      throw new Error('Invalid or expired token');
    }
  }

  static extractToken(authHeader) {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
    return parts[1];
  }

  static createSession(userId, metadata = {}) {
    const accessToken = this.generateToken(userId, metadata);
    return {
      userId,
      accessToken,
      createdAt: new Date().toISOString(),
      expiresIn: JWT_EXPIRATION,
      metadata
    };
  }

  // ── API Keys ─────────────────────────────────────────────────────

  /**
   * Generate a new API key. Returns { key, keyHash, keyPrefix }.
   * The full key is shown once; only the hash + prefix are stored.
   */
  static async generateApiKey(label = 'default') {
    const rawKey = API_KEY_PREFIX + crypto.randomBytes(32).toString('hex');
    const keyHash = await bcrypt.hash(rawKey, SALT_ROUNDS);
    const keyPrefix = rawKey.slice(0, 12) + '...';

    return {
      key: rawKey,         // show to user once
      keyHash,             // store this
      keyPrefix,           // store for display
      label,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Verify an API key against stored hashes.
   * Returns the matching key record or null.
   */
  static async verifyApiKey(providedKey, storedKeys = []) {
    for (const stored of storedKeys) {
      const match = await bcrypt.compare(providedKey, stored.keyHash);
      if (match) return stored;
    }
    return null;
  }

  /**
   * Load API keys from auth store.
   */
  static async getStoredApiKeys() {
    try {
      const authData = await readData(AUTH_FILE);
      return (authData && authData.apiKeys) || [];
    } catch {
      return [];
    }
  }

  /**
   * Save a new API key hash to the auth store.
   */
  static async saveApiKey(keyRecord) {
    let authData = await readData(AUTH_FILE);
    if (!authData) authData = {};
    if (!authData.apiKeys) authData.apiKeys = [];

    // Store hash + metadata, never the raw key
    authData.apiKeys.push({
      keyHash: keyRecord.keyHash,
      keyPrefix: keyRecord.keyPrefix,
      label: keyRecord.label,
      createdAt: keyRecord.createdAt,
      lastUsedAt: null
    });

    await writeData(AUTH_FILE, authData);
    logger.info('[auth] API key saved', { label: keyRecord.label, prefix: keyRecord.keyPrefix });
  }

  /**
   * Revoke an API key by prefix.
   */
  static async revokeApiKey(keyPrefix) {
    let authData = await readData(AUTH_FILE);
    if (!authData || !authData.apiKeys) return { revoked: false };

    const before = authData.apiKeys.length;
    authData.apiKeys = authData.apiKeys.filter(k => k.keyPrefix !== keyPrefix);
    const revoked = authData.apiKeys.length < before;

    if (revoked) {
      await writeData(AUTH_FILE, authData);
      logger.info('[auth] API key revoked', { prefix: keyPrefix });
    }

    return { revoked };
  }
}

// ── Middleware ────────────────────────────────────────────────────────

/**
 * Auth middleware — supports JWT tokens AND API keys.
 * In MOCK_MODE, also accepts the mock admin token.
 * In production, NO mock bypass exists.
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = AuthManager.extractToken(authHeader);

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // 1. API key check (starts with prefix)
    if (token.startsWith(API_KEY_PREFIX)) {
      const storedKeys = await AuthManager.getStoredApiKeys();
      const match = await AuthManager.verifyApiKey(token, storedKeys);
      if (match) {
        req.user = { role: 'api', apiKey: true, label: match.label };
        // Update last-used timestamp (awaited to prevent race condition)
        try {
          const authData = await readData(AUTH_FILE);
          if (authData && authData.apiKeys) {
            const k = authData.apiKeys.find(k => k.keyPrefix === match.keyPrefix);
            if (k) {
              k.lastUsedAt = new Date().toISOString();
              await writeData(AUTH_FILE, authData);
            }
          }
        } catch (e) {
          logger.warn('[auth] Failed to update API key lastUsedAt', { error: e.message });
        }
        return next();
      }
      return res.status(403).json({ error: 'Invalid API key' });
    }

    // 3. JWT verification (with rotation support)
    const decoded = AuthManager.verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('Authentication failed', { error: err.message });
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

const optionalAuthMiddleware = (req, res, next) => {
  try {
    const token = AuthManager.extractToken(req.headers.authorization);
    if (token) {
      // Skip API key check for optional auth — JWT only
      const decoded = AuthManager.verifyToken(token);
      req.user = decoded;
    }
    next();
  } catch {
    next();
  }
};

module.exports = {
  AuthManager,
  authMiddleware,
  optionalAuthMiddleware,
  MOCK_MODE,
  API_KEY_PREFIX,
  JWT_SECRET
};
