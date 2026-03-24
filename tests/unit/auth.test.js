/**
 * Comprehensive Auth Tests
 *
 * Tests for AuthManager class and middleware from utils/auth.js
 * ~40 tests covering password hashing, tokens, API keys, and middleware
 */

// Set env vars BEFORE importing the auth module
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

// Mock storage before importing auth
let mockAuthStore = {};
jest.mock('../../utils/storage', () => ({
  readData: jest.fn(async () => mockAuthStore),
  writeData: jest.fn(async (file, data) => { mockAuthStore = data; }),
  storage: {
    initialize: jest.fn(),
    read: jest.fn(),
    write: jest.fn(),
    append: jest.fn().mockResolvedValue(true)
  }
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const {
  AuthManager,
  authMiddleware,
  optionalAuthMiddleware,
  MOCK_MODE,
  API_KEY_PREFIX
} = require('../../utils/auth');

const { readData, writeData } = require('../../utils/storage');

// ────────────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────────────

const mockReq = (headers = {}) => ({ headers, user: null });
const mockRes = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  return res;
};
const mockNext = jest.fn();

// ────────────────────────────────────────────────────────────────────
// AuthManager.hashPassword / verifyPassword Tests (4 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.hashPassword and verifyPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hashPassword returns a bcrypt hash starting with $2a$ or $2b$', async () => {
    const password = 'TestPassword123!@#';
    const hash = await AuthManager.hashPassword(password);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    expect(/^\$2[aby]\$/.test(hash)).toBe(true); // bcrypt hash format
  });

  test('verifyPassword returns true for correct password', async () => {
    const password = 'TestPassword123!@#';
    const hash = await AuthManager.hashPassword(password);
    const result = await AuthManager.verifyPassword(password, hash);

    expect(result).toBe(true);
  });

  test('verifyPassword returns false for wrong password', async () => {
    const password = 'TestPassword123!@#';
    const wrongPassword = 'WrongPassword456$%^';
    const hash = await AuthManager.hashPassword(password);
    const result = await AuthManager.verifyPassword(wrongPassword, hash);

    expect(result).toBe(false);
  });

  test('hashPassword produces different hashes for same password (salt)', async () => {
    const password = 'TestPassword123!@#';
    const hash1 = await AuthManager.hashPassword(password);
    const hash2 = await AuthManager.hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(/^\$2[aby]\$/.test(hash1)).toBe(true);
    expect(/^\$2[aby]\$/.test(hash2)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// AuthManager.validatePasswordStrength Tests (6 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.validatePasswordStrength', () => {
  test('Strong password returns isValid: true', () => {
    const password = 'StrongPass123!@#';
    const result = AuthManager.validatePasswordStrength(password);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('Short password (<12 chars) returns error', () => {
    const password = 'Short1!';
    const result = AuthManager.validatePasswordStrength(password);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 12 characters');
  });

  test('Missing uppercase returns error', () => {
    const password = 'lowercase123!@#';
    const result = AuthManager.validatePasswordStrength(password);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Must contain at least one uppercase letter');
  });

  test('Missing number returns error', () => {
    const password = 'NoNumberPass!@#';
    const result = AuthManager.validatePasswordStrength(password);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Must contain at least one number');
  });

  test('Missing special char returns error', () => {
    const password = 'NoSpecialChar123';
    const result = AuthManager.validatePasswordStrength(password);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Must contain at least one special character');
  });

  test('Multiple failures returns multiple errors', () => {
    const password = 'short';
    const result = AuthManager.validatePasswordStrength(password);

    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// AuthManager.generateToken / verifyToken Tests (5 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.generateToken and verifyToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generateToken returns a string JWT', () => {
    const userId = 'user123';
    const token = AuthManager.generateToken(userId);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  test('verifyToken decodes valid token correctly', () => {
    const userId = 'user123';
    const metadata = { role: 'admin' };
    const token = AuthManager.generateToken(userId, metadata);
    const decoded = AuthManager.verifyToken(token);

    expect(decoded).toBeDefined();
    expect(decoded.userId).toBe(userId);
    expect(decoded.role).toBe('admin');
  });

  test('verifyToken throws for invalid/tampered token', () => {
    const tamperedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.invalid_signature';

    expect(() => AuthManager.verifyToken(tamperedToken)).toThrow('Invalid or expired token');
  });

  test('Token contains userId in payload', () => {
    const userId = 'user456';
    const token = AuthManager.generateToken(userId);
    const decoded = AuthManager.verifyToken(token);

    expect(decoded.userId).toBe(userId);
  });

  test('Token contains type: access in payload', () => {
    const userId = 'user789';
    const token = AuthManager.generateToken(userId);
    const decoded = AuthManager.verifyToken(token);

    expect(decoded.type).toBe('access');
  });
});

// ────────────────────────────────────────────────────────────────────
// AuthManager.extractToken Tests (4 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.extractToken', () => {
  test('Returns token from Bearer <token> header', () => {
    const token = 'mytoken123';
    const authHeader = `Bearer ${token}`;
    const extracted = AuthManager.extractToken(authHeader);

    expect(extracted).toBe(token);
  });

  test('Returns null for missing header', () => {
    const extracted = AuthManager.extractToken(null);

    expect(extracted).toBeNull();
  });

  test('Returns null for non-Bearer scheme', () => {
    const authHeader = 'Basic somebase64string';
    const extracted = AuthManager.extractToken(authHeader);

    expect(extracted).toBeNull();
  });

  test('Returns null for malformed header', () => {
    const authHeader = 'BearerOnlyToken'; // missing space
    const extracted = AuthManager.extractToken(authHeader);

    expect(extracted).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// AuthManager.createSession Tests (3 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.createSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Returns object with userId, accessToken, createdAt, expiresIn', () => {
    const userId = 'user123';
    const session = AuthManager.createSession(userId);

    expect(session).toHaveProperty('userId');
    expect(session).toHaveProperty('accessToken');
    expect(session).toHaveProperty('createdAt');
    expect(session).toHaveProperty('expiresIn');
  });

  test('accessToken is a valid JWT', () => {
    const userId = 'user123';
    const session = AuthManager.createSession(userId);

    expect(typeof session.accessToken).toBe('string');
    expect(session.accessToken.split('.')).toHaveLength(3);

    const decoded = AuthManager.verifyToken(session.accessToken);
    expect(decoded.userId).toBe(userId);
  });

  test('metadata is passed through', () => {
    const userId = 'user123';
    const metadata = { role: 'editor', department: 'marketing' };
    const session = AuthManager.createSession(userId, metadata);

    const decoded = AuthManager.verifyToken(session.accessToken);
    expect(decoded.role).toBe('editor');
    expect(decoded.department).toBe('marketing');
  });
});

// ────────────────────────────────────────────────────────────────────
// AuthManager.generateApiKey Tests (3 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.generateApiKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Returns key starting with cao_', async () => {
    const keyRecord = await AuthManager.generateApiKey();

    expect(keyRecord.key).toBeDefined();
    expect(keyRecord.key.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  test('Returns keyHash (bcrypt hash)', async () => {
    const keyRecord = await AuthManager.generateApiKey();

    expect(keyRecord.keyHash).toBeDefined();
    expect(typeof keyRecord.keyHash).toBe('string');
    expect(/^\$2[aby]\$/.test(keyRecord.keyHash)).toBe(true);
  });

  test('Returns keyPrefix (first 12 chars + ...)', async () => {
    const keyRecord = await AuthManager.generateApiKey();

    expect(keyRecord.keyPrefix).toBeDefined();
    expect(keyRecord.keyPrefix).toBe(keyRecord.key.slice(0, 12) + '...');
    expect(keyRecord.keyPrefix.endsWith('...')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// AuthManager.verifyApiKey Tests (3 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.verifyApiKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStore = {};
  });

  test('Returns matching stored key when key is valid', async () => {
    const keyRecord = await AuthManager.generateApiKey('test-key');
    const storedKeys = [keyRecord];

    const match = await AuthManager.verifyApiKey(keyRecord.key, storedKeys);

    expect(match).toBeDefined();
    expect(match.label).toBe('test-key');
  });

  test('Returns null when key does not match', async () => {
    const keyRecord = await AuthManager.generateApiKey();
    const wrongKey = 'cao_wrongkeywrongkeywrongkey';
    const storedKeys = [keyRecord];

    const match = await AuthManager.verifyApiKey(wrongKey, storedKeys);

    expect(match).toBeNull();
  });

  test('Returns null for empty storedKeys array', async () => {
    const providedKey = 'cao_somekey';
    const storedKeys = [];

    const match = await AuthManager.verifyApiKey(providedKey, storedKeys);

    expect(match).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// AuthManager.saveApiKey / getStoredApiKeys / revokeApiKey Tests (4 tests)
// ────────────────────────────────────────────────────────────────────

describe('AuthManager.saveApiKey, getStoredApiKeys, and revokeApiKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStore = {};
  });

  test('saveApiKey stores key record in auth data', async () => {
    const keyRecord = await AuthManager.generateApiKey('test-label');

    await AuthManager.saveApiKey(keyRecord);

    expect(writeData).toHaveBeenCalled();
    expect(mockAuthStore.apiKeys).toBeDefined();
    expect(mockAuthStore.apiKeys).toHaveLength(1);
    expect(mockAuthStore.apiKeys[0].label).toBe('test-label');
  });

  test('getStoredApiKeys returns stored keys', async () => {
    const keyRecord = await AuthManager.generateApiKey('stored-key');
    await AuthManager.saveApiKey(keyRecord);

    const stored = await AuthManager.getStoredApiKeys();

    expect(stored).toHaveLength(1);
    expect(stored[0].label).toBe('stored-key');
  });

  test('revokeApiKey removes key by prefix', async () => {
    const keyRecord = await AuthManager.generateApiKey('to-revoke');
    await AuthManager.saveApiKey(keyRecord);

    const result = await AuthManager.revokeApiKey(keyRecord.keyPrefix);

    expect(result.revoked).toBe(true);
    const remaining = await AuthManager.getStoredApiKeys();
    expect(remaining).toHaveLength(0);
  });

  test('revokeApiKey returns { revoked: false } when prefix not found', async () => {
    const result = await AuthManager.revokeApiKey('cao_nonexistent...');

    expect(result.revoked).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// authMiddleware Tests (5 tests)
// ────────────────────────────────────────────────────────────────────

describe('authMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStore = {};
  });

  test('Returns 401 when no authorization header', async () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('Returns 401 for invalid JWT', async () => {
    const req = mockReq({ authorization: 'Bearer invalid_token_here' });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
    expect(next).not.toHaveBeenCalled();
  });

  test('Calls next() with valid JWT and sets req.user', async () => {
    const userId = 'user123';
    const token = AuthManager.generateToken(userId);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe(userId);
  });

  test('Returns 403 for invalid API key (starts with cao_ but does not match)', async () => {
    const invalidApiKey = 'cao_invalidkeythatdoesnotexist';
    const req = mockReq({ authorization: `Bearer ${invalidApiKey}` });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    expect(next).not.toHaveBeenCalled();
  });

  test('Accepts valid API key and sets req.user with role: api', async () => {
    const keyRecord = await AuthManager.generateApiKey('valid-api-key');
    await AuthManager.saveApiKey(keyRecord);

    const req = mockReq({ authorization: `Bearer ${keyRecord.key}` });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.role).toBe('api');
    expect(req.user.apiKey).toBe(true);
    expect(req.user.label).toBe('valid-api-key');
  });
});

// ────────────────────────────────────────────────────────────────────
// optionalAuthMiddleware Tests (3 tests)
// ────────────────────────────────────────────────────────────────────

describe('optionalAuthMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStore = {};
  });

  test('Calls next() without token (no error)', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = jest.fn();

    optionalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeNull();
  });

  test('Sets req.user when valid JWT provided', () => {
    const userId = 'user123';
    const token = AuthManager.generateToken(userId);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    optionalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe(userId);
  });

  test('Calls next() without error when invalid JWT provided', () => {
    const req = mockReq({ authorization: 'Bearer invalid_token' });
    const res = mockRes();
    const next = jest.fn();

    optionalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// Integration and Edge Cases (bonus tests)
// ────────────────────────────────────────────────────────────────────

describe('Integration and Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStore = {};
  });

  test('MOCK_MODE is true', () => {
    expect(MOCK_MODE).toBe(true);
  });

  test('API_KEY_PREFIX is set correctly', () => {
    expect(API_KEY_PREFIX).toBe('cao_');
  });

  test('Full workflow: create user, generate token, verify, use in middleware', async () => {
    const userId = 'integration-user';
    const metadata = { role: 'admin', org: 'test-org' };

    // Create session
    const session = AuthManager.createSession(userId, metadata);
    expect(session.accessToken).toBeDefined();

    // Use in middleware
    const req = mockReq({ authorization: `Bearer ${session.accessToken}` });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe(userId);
    expect(req.user.role).toBe('admin');
  });

  test('Full API key workflow: generate, save, retrieve, verify', async () => {
    // Generate
    const keyRecord = await AuthManager.generateApiKey('integration-api-key');
    expect(keyRecord.key).toBeDefined();

    // Save
    await AuthManager.saveApiKey(keyRecord);

    // Retrieve
    const stored = await AuthManager.getStoredApiKeys();
    expect(stored).toHaveLength(1);

    // Verify
    const match = await AuthManager.verifyApiKey(keyRecord.key, stored);
    expect(match).toBeDefined();
    expect(match.label).toBe('integration-api-key');
  });

  test('Bearer token case-insensitive for extraction', () => {
    const token = 'mytoken123';

    // lowercase
    expect(AuthManager.extractToken(`bearer ${token}`)).toBe(token);

    // uppercase
    expect(AuthManager.extractToken(`BEARER ${token}`)).toBe(token);

    // mixed
    expect(AuthManager.extractToken(`BeArEr ${token}`)).toBe(token);
  });

  test('Password strength validation with all valid special characters', () => {
    const specialChars = '!@#$%^&*()_+-=[]{};\':"|,.<>/?`~';

    for (const char of specialChars.split('')) {
      const password = `ValidPass123${char}`;
      const result = AuthManager.validatePasswordStrength(password);
      expect(result.isValid).toBe(true);
    }
  });
});
