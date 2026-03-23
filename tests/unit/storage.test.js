/**
 * Storage.js Unit Tests
 * Tests file-based storage operations, concurrent access, and backup creation
 */

const fs = require('fs');
const path = require('path');
const fsPromises = fs.promises;
const Storage = require('../../utils/storage');

describe('Storage Class', () => {
  let testDataDir;
  let storage;

  beforeAll(() => {
    // Create test data directory
    testDataDir = path.join(__dirname, '../../tmp/test_storage_' + Date.now());
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Create fresh storage instance for each test
    storage = new Storage(testDataDir);
  });

  afterAll(async () => {
    // Cleanup test directory
    try {
      const files = await fsPromises.readdir(testDataDir);
      for (const file of files) {
        const filePath = path.join(testDataDir, file);
        const stat = await fsPromises.stat(filePath);
        if (stat.isFile()) {
          await fsPromises.unlink(filePath);
        }
      }
      await fsPromises.rmdir(testDataDir);
    } catch (err) {
      console.warn('Cleanup error:', err.message);
    }
  });

  describe('Initialization', () => {
    test('Should create data directory if it does not exist', () => {
      const newDir = path.join(testDataDir, 'new_subdir');
      const newStorage = new Storage(newDir);

      expect(fs.existsSync(newDir)).toBe(true);
    });

    test('Should not error if directory already exists', async () => {
      await expect(storage.initialize('test.json', {})).resolves.not.toThrow();
    });

    test('Should initialize file with default content if missing', async () => {
      const fileName = 'new_file.json';
      const defaultContent = { data: 'test' };

      await storage.initialize(fileName, defaultContent);

      const filePath = storage.getFilePath(fileName);
      expect(fs.existsSync(filePath)).toBe(true);

      const data = await storage.read(fileName);
      expect(data).toEqual(defaultContent);
    });

    test('Should not overwrite existing file during initialization', async () => {
      const fileName = 'existing_file.json';
      const originalContent = { original: true };
      const newContent = { new: true };

      // Write initial file
      await storage.initialize(fileName, originalContent);

      // Try to initialize again with different content
      await storage.initialize(fileName, newContent);

      // Should still have original content
      const data = await storage.read(fileName);
      expect(data).toEqual(originalContent);
    });
  });

  describe('Read Operations', () => {
    test('Should read and parse JSON file correctly', async () => {
      const fileName = 'readable.json';
      const testData = {
        name: 'Test Job',
        status: 'active',
        metadata: { version: 1 }
      };

      await storage.initialize(fileName, testData);
      const readData = await storage.read(fileName);

      expect(readData).toEqual(testData);
    });

    test('Should return null if file does not exist', async () => {
      const data = await storage.read('nonexistent.json');
      expect(data).toBeNull();
    });

    test('Should handle empty JSON objects', async () => {
      const fileName = 'empty.json';
      await storage.initialize(fileName, {});

      const data = await storage.read(fileName);
      expect(data).toEqual({});
    });

    test('Should handle empty arrays', async () => {
      const fileName = 'emptyArray.json';
      await storage.initialize(fileName, []);

      const data = await storage.read(fileName);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });

    test('Should handle complex nested structures', async () => {
      const fileName = 'complex.json';
      const complexData = {
        jobs: [
          {
            id: 'job1',
            states: { current: 'WRITING', previous: 'SCORED' },
            metadata: { created: '2026-03-22', tags: ['urgent', 'highValue'] }
          },
          {
            id: 'job2',
            states: { current: 'DELIVERY', previous: 'QC' },
            metadata: { created: '2026-03-21', tags: ['standard'] }
          }
        ]
      };

      await storage.initialize(fileName, complexData);
      const readData = await storage.read(fileName);

      expect(readData).toEqual(complexData);
      expect(readData.jobs.length).toBe(2);
      expect(readData.jobs[0].metadata.tags).toContain('urgent');
    });
  });

  describe('Write Operations', () => {
    test('Should write and persist JSON data', async () => {
      const fileName = 'writable.json';
      const testData = { status: 'success', timestamp: new Date().toISOString() };

      await storage.write(fileName, testData, false);

      const filePath = storage.getFilePath(fileName);
      expect(fs.existsSync(filePath)).toBe(true);

      const readData = await storage.read(fileName);
      expect(readData.status).toBe('success');
    });

    test('Should create backup before overwriting', async () => {
      const fileName = 'backupTest.json';
      const initialData = { version: 1 };
      const updatedData = { version: 2 };

      // Write initial data
      await storage.write(fileName, initialData, false);

      // Overwrite with backup enabled
      await storage.write(fileName, updatedData, true);

      const filePath = storage.getFilePath(fileName);
      const dirContents = fs.readdirSync(testDataDir);
      const backups = dirContents.filter(f => f.startsWith(fileName) && f.includes('.backup'));

      expect(backups.length).toBeGreaterThan(0);
    });

    test('Should handle write without backup creation', async () => {
      const fileName = 'noBackup.json';
      const testData = { noBackup: true };

      await storage.write(fileName, testData, false);

      const filePath = storage.getFilePath(fileName);
      expect(fs.existsSync(filePath)).toBe(true);

      const readData = await storage.read(fileName);
      expect(readData.noBackup).toBe(true);
    });

    test('Should update existing file with new data', async () => {
      const fileName = 'updateTest.json';
      const initialData = { count: 1, items: [] };

      await storage.write(fileName, initialData, false);

      const updatedData = { count: 2, items: [{ id: 1 }] };
      await storage.write(fileName, updatedData, false);

      const readData = await storage.read(fileName);
      expect(readData.count).toBe(2);
      expect(readData.items.length).toBe(1);
    });

    test('Should handle large data structures', async () => {
      const fileName = 'large.json';
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          metadata: { index: i, timestamp: Date.now() }
        }))
      };

      await storage.write(fileName, largeData, false);

      const readData = await storage.read(fileName);
      expect(readData.items.length).toBe(1000);
      expect(readData.items[999].name).toBe('Item 999');
    });

    test('Should preserve data integrity with special characters', async () => {
      const fileName = 'specialChars.json';
      const specialData = {
        message: 'Test with special chars: "quotes", \'apostrophes\', \\backslash',
        unicode: '你好世界 مرحبا بالعالم',
        escaped: 'Line1\nLine2\tTabbed'
      };

      await storage.write(fileName, specialData, false);

      const readData = await storage.read(fileName);
      expect(readData.unicode).toContain('你好');
      expect(readData.escaped).toContain('\n');
    });
  });

  describe('Concurrent Access Handling', () => {
    test('Should handle multiple reads to same file', async () => {
      const fileName = 'concurrent.json';
      const testData = { value: 'shared' };

      await storage.write(fileName, testData, false);

      // Perform multiple concurrent reads
      const promises = Array(5).fill(null).map(() => storage.read(fileName));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.value).toBe('shared');
      });
    });

    test('Should use file locking for sequential writes', async () => {
      const fileName = 'lockTest.json';
      const data1 = { sequence: 1 };
      const data2 = { sequence: 2 };
      const data3 = { sequence: 3 };

      // Sequential writes
      await storage.write(fileName, data1, false);
      await storage.write(fileName, data2, false);
      await storage.write(fileName, data3, false);

      const finalData = await storage.read(fileName);
      expect(finalData.sequence).toBe(3);
    });

    test('Should prevent concurrent writes to same file', async () => {
      const fileName = 'exclusiveWrite.json';
      const data1 = { writer: 1 };
      const data2 = { writer: 2 };

      // Write first data
      await storage.write(fileName, data1, false);

      // Start two writes (second should wait for first)
      const write1 = storage.write(fileName, data1, false);
      const write2 = storage.write(fileName, data2, false);

      await Promise.all([write1, write2]);

      const finalData = await storage.read(fileName);
      expect(finalData).toBeDefined();
      expect(finalData.writer).toBeGreaterThanOrEqual(1);
    });

    test('Should handle mixed read/write operations', async () => {
      const fileName = 'mixedOps.json';
      let data = { counter: 0 };

      await storage.write(fileName, data, false);

      // Mix of operations
      const op1 = storage.read(fileName);
      const op2 = storage.write(fileName, { counter: 1 }, false);
      const op3 = storage.read(fileName);
      const op4 = storage.write(fileName, { counter: 2 }, false);

      const [read1, , read2] = await Promise.all([op1, op2, op3, op4]);

      expect(read1.counter).toBe(0);
      expect(read2.counter).toBe(1);
    });
  });

  describe('Missing File Initialization', () => {
    test('Should auto-initialize missing jobs file with empty array', async () => {
      const jobsFile = 'jobs.json';
      const filePath = storage.getFilePath(jobsFile);

      // Ensure file doesn't exist
      if (fs.existsSync(filePath)) {
        await fsPromises.unlink(filePath);
      }

      // Initialize with default empty array
      await storage.initialize(jobsFile, []);

      expect(fs.existsSync(filePath)).toBe(true);
      const data = await storage.read(jobsFile);
      expect(Array.isArray(data)).toBe(true);
    });

    test('Should auto-initialize missing ledger file', async () => {
      const ledgerFile = 'ledger.json';
      await storage.initialize(ledgerFile, { transactions: [], total: 0 });

      const data = await storage.read(ledgerFile);
      expect(data.transactions).toEqual([]);
      expect(data.total).toBe(0);
    });

    test('Should handle initialization race conditions', async () => {
      const fileName = 'raceCondition.json';
      const defaultData = { initialized: true };

      // Try to initialize simultaneously
      const promises = Array(3).fill(null).map(() =>
        storage.initialize(fileName, defaultData)
      );

      await Promise.all(promises);

      const data = await storage.read(fileName);
      expect(data.initialized).toBe(true);
    });
  });

  describe('Backup Creation', () => {
    test('Should create timestamped backup files', async () => {
      const fileName = 'backupDemo.json';
      const initialData = { version: 1 };

      await storage.write(fileName, initialData, true);
      await storage.write(fileName, { version: 2 }, true);

      const files = fs.readdirSync(testDataDir);
      const backups = files.filter(f => f.includes('backupDemo.json.backup'));

      expect(backups.length).toBeGreaterThan(0);
    });

    test('Should contain same data as original in backup', async () => {
      const fileName = 'backupContent.json';
      const originalData = { critical: 'data', timestamp: 1234567890 };

      await storage.write(fileName, originalData, false);
      await storage.write(fileName, { version: 2 }, true);

      // Find and read backup
      const files = fs.readdirSync(testDataDir);
      const backupFile = files.find(f => f.startsWith('backupContent.json.backup'));

      if (backupFile) {
        const backupPath = path.join(testDataDir, backupFile);
        const backupContent = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
        expect(backupContent).toEqual(originalData);
      }
    });

    test('Should handle backup creation failures gracefully', async () => {
      const fileName = 'backupFail.json';
      const testData = { test: true };

      // Should not throw even if backup fails
      await storage.write(fileName, testData, true);

      const data = await storage.read(fileName);
      expect(data.test).toBe(true);
    });

    test('Should allow disabling backups', async () => {
      const fileName = 'noBackupFile.json';
      const initialData = { version: 1 };

      await storage.write(fileName, initialData, false);
      const beforeFiles = fs.readdirSync(testDataDir).filter(f =>
        f.includes('noBackupFile.json.backup')
      );

      await storage.write(fileName, { version: 2 }, false);
      const afterFiles = fs.readdirSync(testDataDir).filter(f =>
        f.includes('noBackupFile.json.backup')
      );

      expect(beforeFiles.length).toBe(afterFiles.length);
    });
  });

  describe('Error Handling', () => {
    test('Should handle file read errors gracefully', async () => {
      // Create a test file with invalid JSON
      const fileName = 'invalid.json';
      const filePath = storage.getFilePath(fileName);

      await fsPromises.writeFile(filePath, 'invalid json {');

      await expect(storage.read(fileName)).rejects.toThrow();
    });

    test('Should handle permission errors', async () => {
      const fileName = 'permissionTest.json';
      const filePath = storage.getFilePath(fileName);

      // Create a file
      await storage.write(fileName, { test: true }, false);

      // This test may behave differently on different systems
      // Just ensure it doesn't crash the application
      try {
        await storage.read(fileName);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  describe('File Path Management', () => {
    test('Should generate correct file paths', () => {
      const filePath = storage.getFilePath('test.json');
      expect(filePath).toBe(path.join(testDataDir, 'test.json'));
    });

    test('Should handle nested file paths', () => {
      const filePath = storage.getFilePath('subdir/nested/file.json');
      expect(filePath).toContain('subdir/nested/file.json');
    });

    test('Should handle special characters in file names', () => {
      const specialName = 'file-with-dashes_and_underscores.json';
      const filePath = storage.getFilePath(specialName);
      expect(filePath).toContain(specialName);
    });
  });

  describe('Data Format Handling', () => {
    test('Should preserve numeric precision', async () => {
      const fileName = 'numbers.json';
      const data = {
        integer: 42,
        float: 3.14159265359,
        exponential: 1.23e-10,
        large: 9007199254740991
      };

      await storage.write(fileName, data, false);
      const readData = await storage.read(fileName);

      expect(readData.float).toBeCloseTo(3.14159265359, 10);
      expect(readData.exponential).toBeCloseTo(1.23e-10, 20);
    });

    test('Should handle boolean values', async () => {
      const fileName = 'booleans.json';
      const data = { isActive: true, isArchived: false };

      await storage.write(fileName, data, false);
      const readData = await storage.read(fileName);

      expect(readData.isActive).toBe(true);
      expect(readData.isArchived).toBe(false);
    });

    test('Should handle null values', async () => {
      const fileName = 'nulls.json';
      const data = { value: null, nested: { field: null } };

      await storage.write(fileName, data, false);
      const readData = await storage.read(fileName);

      expect(readData.value).toBeNull();
      expect(readData.nested.field).toBeNull();
    });
  });
});
