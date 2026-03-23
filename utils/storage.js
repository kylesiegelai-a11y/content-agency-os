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
    this.ensureDataDir();
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
      // Write directly — temp+rename can fail on some mounted filesystems
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
      logger.debug(`Updated file: ${fileName}`);
      return true;
    } catch (err) {
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

const storage = new Storage(process.env.DATABASE_PATH || './data');

// Export both the instance and compatibility helpers matching agent import pattern
module.exports = storage;
module.exports.storage = storage;
module.exports.readData = (fileName) => storage.read(fileName);
module.exports.writeData = (fileName, data) => storage.write(fileName, data);
module.exports.appendToArray = (fileName, item) => storage.append(fileName, item);
module.exports.findById = (fileName, id, idField) => storage.findById(fileName, id, idField);
module.exports.updateById = (fileName, id, updates, idField) => storage.updateById(fileName, id, updates, idField);
module.exports.deleteById = (fileName, id, idField) => storage.deleteById(fileName, id, idField);
module.exports.listData = (fileName, filter) => storage.list(fileName, filter);
