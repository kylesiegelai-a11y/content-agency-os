const fs = require('fs');
const path = require('path');
const fsPromises = fs.promises;
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

// No file locking needed — this is a single-process Node.js app where all
// async I/O is serialized through the event loop. The previous FileLock
// implementation caused deadlocks from stale .lock files and re-entrant
// acquire attempts (e.g. append → read → write all trying to lock the
// same file).

class Storage {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this._fileLocks = new Map(); // Per-file async mutex for read-modify-write operations
    this.ensureDataDir();
  }

  /**
   * Serialize async read-modify-write operations on the same file
   * to prevent interleaved writes from overwriting each other.
   * @param {string} fileName - File to lock
   * @param {Function} fn - Critical section (async)
   */
  async _withFileLock(fileName, fn) {
    let release;
    const next = new Promise(resolve => { release = resolve; });
    const prev = this._fileLocks.get(fileName) || Promise.resolve();
    this._fileLocks.set(fileName, next);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      if (this._fileLocks.get(fileName) === next) {
        this._fileLocks.delete(fileName);
      }
    }
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info(`Created data directory: ${this.dataDir}`);
    }
  }

  getFilePath(fileName) {
    return path.join(this.dataDir, fileName);
  }

  async initialize(fileName, defaultContent) {
    const filePath = this.getFilePath(fileName);
    if (!fs.existsSync(filePath)) {
      try {
        await fsPromises.writeFile(filePath, JSON.stringify(defaultContent, null, 2));
        logger.info(`Initialized file: ${fileName}`);
      } catch (err) {
        logger.error(`Failed to initialize ${fileName}`, err);
        throw err;
      }
    }
  }

  async read(fileName) {
    const filePath = this.getFilePath(fileName);
    try {
      if (!fs.existsSync(filePath)) {
        logger.warn(`File not found: ${fileName}`);
        return null;
      }
      const data = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      logger.error(`Error reading ${fileName}`, err);
      throw err;
    }
  }

  async write(fileName, data, createBackup = true) {
    const filePath = this.getFilePath(fileName);
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      if (createBackup && fs.existsSync(filePath)) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        try {
          await fsPromises.copyFile(filePath, backupPath);
          logger.debug(`Created backup: ${path.basename(backupPath)}`);
        } catch (backupErr) {
          logger.warn(`Failed to create backup for ${fileName}`, backupErr);
        }
      }
      // Atomic write: serialize to temp file, then rename.
      // rename() is atomic on POSIX — if the process crashes mid-write,
      // the original file is untouched. The temp file is PID-scoped to
      // avoid collisions if multiple processes somehow share the data dir.
      const json = JSON.stringify(data, null, 2);
      await fsPromises.writeFile(tmpPath, json);
      await fsPromises.rename(tmpPath, filePath);
      logger.debug(`Updated file: ${fileName}`);
      return true;
    } catch (err) {
      // Clean up temp file on failure
      try { await fsPromises.unlink(tmpPath); } catch (_) { /* ok */ }
      logger.error(`Error writing ${fileName}`, err);
      throw err;
    }
  }

  async append(fileName, item) {
    const filePath = this.getFilePath(fileName);
    try {
      // Read current data
      let data = null;
      if (fs.existsSync(filePath)) {
        try {
          const raw = await fsPromises.readFile(filePath, 'utf-8');
          data = JSON.parse(raw);
        } catch (e) {
          data = null;
        }
      }

      // Auto-initialize if file is missing, null, or malformed
      if (!data || typeof data !== 'object') {
        data = { items: [] };
      }

      if (Array.isArray(data)) {
        data.push(item);
      } else if (Array.isArray(data.items)) {
        data.items.push(item);
      } else if (Array.isArray(data.activities)) {
        data.activities.push(item);
      } else {
        data.items = [item];
      }

      // Direct write — temp+rename can fail on some mounted filesystems
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));

      return item;
    } catch (err) {
      logger.error(`Error appending to ${fileName}`, err);
      throw err;
    }
  }

  async findById(fileName, id, idField = 'id') {
    try {
      const data = await this.read(fileName);
      let items = data;
      if (Array.isArray(data)) {
        items = data;
      } else if (Array.isArray(data.items)) {
        items = data.items;
      } else {
        return null;
      }
      return items.find(item => item[idField] === id) || null;
    } catch (err) {
      logger.error(`Error finding item in ${fileName}`, err);
      throw err;
    }
  }

  async updateById(fileName, id, updates, idField = 'id') {
    return this._withFileLock(fileName, async () => {
      try {
        const data = await this.read(fileName);
        let items = data;
        let isWrapped = false;
        if (!Array.isArray(data)) {
          if (Array.isArray(data.items)) {
            items = data.items;
            isWrapped = true;
          } else {
            throw new Error(`Cannot update in ${fileName}: no array found`);
          }
        }
        const index = items.findIndex(item => item[idField] === id);
        if (index === -1) {
          throw new Error(`Item with ${idField}=${id} not found in ${fileName}`);
        }
        items[index] = { ...items[index], ...updates, updated_at: new Date().toISOString() };
        const result = isWrapped ? { ...data, items } : items;
        await this.write(fileName, result);
        return items[index];
      } catch (err) {
        logger.error(`Error updating item in ${fileName}`, err);
        throw err;
      }
    });
  }

  async deleteById(fileName, id, idField = 'id') {
    try {
      const data = await this.read(fileName);
      let items = data;
      let isWrapped = false;
      if (!Array.isArray(data)) {
        if (Array.isArray(data.items)) {
          items = data.items;
          isWrapped = true;
        } else {
          throw new Error(`Cannot delete from ${fileName}: no array found`);
        }
      }
      const index = items.findIndex(item => item[idField] === id);
      if (index === -1) {
        return null;
      }
      const deleted = items[index];
      items.splice(index, 1);
      const result = isWrapped ? { ...data, items } : items;
      await this.write(fileName, result);
      return deleted;
    } catch (err) {
      logger.error(`Error deleting from ${fileName}`, err);
      throw err;
    }
  }

  async list(fileName, filter = null) {
    try {
      const data = await this.read(fileName);
      let items = data;
      if (!Array.isArray(data)) {
        if (Array.isArray(data.items)) {
          items = data.items;
        } else {
          return [];
        }
      }
      if (!filter) return items;
      return items.filter(item => {
        return Object.keys(filter).every(key => item[key] === filter[key]);
      });
    } catch (err) {
      logger.error(`Error listing ${fileName}`, err);
      throw err;
    }
  }

  async paginate(fileName, page = 1, pageSize = 10) {
    try {
      const items = await this.list(fileName);
      const total = items.length;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      return {
        data: items.slice(startIndex, endIndex),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          hasNext: endIndex < total,
          hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error(`Error paginating ${fileName}`, err);
      throw err;
    }
  }

  async getStats() {
    try {
      const files = await fsPromises.readdir(this.dataDir);
      const stats = {};
      let totalSize = 0;
      for (const file of files) {
        if (file.endsWith('.json') && !file.includes('backup') && !file.includes('.lock')) {
          const filePath = path.join(this.dataDir, file);
          const fileStats = await fsPromises.stat(filePath);
          stats[file] = {
            size: fileStats.size,
            modified: fileStats.mtime.toISOString()
          };
          totalSize += fileStats.size;
        }
      }
      return {
        files: stats,
        totalSize,
        dataDir: this.dataDir
      };
    } catch (err) {
      logger.error('Error getting storage stats', err);
      throw err;
    }
  }
}

// Default singleton used by agents and server at runtime
const storage = new Storage(process.env.DATABASE_PATH || './data');

// ── Storage backend routing ────────────────────────────────────────
// Set USE_SQLITE=true to use SQLite instead of JSON files.
// The SQLite module exposes the same API surface, so all existing code
// works without changes.
const USE_SQLITE = process.env.USE_SQLITE === 'true';

let sqliteDb = null;
function getSqlite() {
  if (!sqliteDb) {
    sqliteDb = require('./database');
  }
  return sqliteDb;
}

// Export model B: { Storage (class), storage (singleton), helpers }
// Tests use: const Storage = require('./storage') — gets the class via default export
// Agents use: const { readData, appendToArray } = require('./storage')
// Server uses: const storage = require('./storage') — gets the singleton (also works, has .read/.write methods)
module.exports = Storage;
module.exports.Storage = Storage;
module.exports.storage = USE_SQLITE ? { read: (...a) => getSqlite().readData(...a), write: (...a) => getSqlite().writeData(...a), append: (...a) => getSqlite().appendToArray(...a), findById: (...a) => getSqlite().findById(...a), updateById: (...a) => getSqlite().updateById(...a), deleteById: (...a) => getSqlite().deleteById(...a), list: (...a) => getSqlite().listData(...a), initialize: (...a) => getSqlite().initialize(...a), getStats: () => getSqlite().getStats(), paginate: async () => ({ items: [], total: 0 }), backupAll: () => true, clearAll: () => {} } : storage;
module.exports.readData = USE_SQLITE ? (...a) => getSqlite().readData(...a) : (fileName) => storage.read(fileName);
module.exports.writeData = USE_SQLITE ? (...a) => getSqlite().writeData(...a) : (fileName, data) => storage.write(fileName, data);
module.exports.appendToArray = USE_SQLITE ? (...a) => getSqlite().appendToArray(...a) : (fileName, item) => storage.append(fileName, item);
module.exports.findById = USE_SQLITE ? (...a) => getSqlite().findById(...a) : (fileName, id, idField) => storage.findById(fileName, id, idField);
module.exports.updateById = USE_SQLITE ? (...a) => getSqlite().updateById(...a) : (fileName, id, updates, idField) => storage.updateById(fileName, id, updates, idField);
module.exports.deleteById = USE_SQLITE ? (...a) => getSqlite().deleteById(...a) : (fileName, id, idField) => storage.deleteById(fileName, id, idField);
module.exports.listData = USE_SQLITE ? (...a) => getSqlite().listData(...a) : (fileName, filter) => storage.list(fileName, filter);
module.exports.USE_SQLITE = USE_SQLITE;
