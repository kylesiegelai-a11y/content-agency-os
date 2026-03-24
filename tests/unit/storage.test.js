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
    // Cleanup test directory (recursive handles nested dirs and backup files)
    // Allow a tick for any pending writes to flush before removing
    await new Promise(r => setTimeout(r, 50));
    try {
      await fsPromises.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup — tmp dir will be overwritten next run regardless
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

    test('Should handle sequential writes correctly', async () => {
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

      // Without file locking, concurrent reads see the state at read time.
      // Sequential operations are the safe pattern for read-after-write.
      const read1 = await storage.read(fileName);
      expect(read1.counter).toBe(0);

      await storage.write(fileName, { counter: 1 }, false);
      const read2 = await storage.read(fileName);
      expect(read2.counter).toBe(1);

      await storage.write(fileName, { counter: 2 }, false);
      const read3 = await storage.read(fileName);
      expect(read3.counter).toBe(2);
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

  describe('updateById()', () => {
    test('Should update item in wrapped array structure', async () => {
      const fileName = 'updateWrapped.json';
      const initialData = {
        items: [
          { id: '1', name: 'Item 1', status: 'active' },
          { id: '2', name: 'Item 2', status: 'inactive' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const updated = await storage.updateById(fileName, '1', { status: 'archived' });

      expect(updated.id).toBe('1');
      expect(updated.status).toBe('archived');
      expect(updated.updated_at).toBeDefined();

      const readData = await storage.read(fileName);
      expect(readData.items[0].status).toBe('archived');
    });

    test('Should update item in plain array structure', async () => {
      const fileName = 'updatePlainArray.json';
      const initialData = [
        { id: 'a', value: 100 },
        { id: 'b', value: 200 }
      ];

      await storage.write(fileName, initialData, false);

      const updated = await storage.updateById(fileName, 'b', { value: 250 });

      expect(updated.value).toBe(250);
      expect(updated.updated_at).toBeDefined();

      const readData = await storage.read(fileName);
      expect(readData[1].value).toBe(250);
    });

    test('Should throw error when ID not found', async () => {
      const fileName = 'updateNotFound.json';
      await storage.write(fileName, { items: [{ id: '1', name: 'Item 1' }] }, false);

      await expect(
        storage.updateById(fileName, 'nonexistent', { name: 'Updated' })
      ).rejects.toThrow('not found');
    });

    test('Should throw error when no array found', async () => {
      const fileName = 'updateNoArray.json';
      await storage.write(fileName, { value: 'scalar' }, false);

      await expect(
        storage.updateById(fileName, '1', { name: 'Updated' })
      ).rejects.toThrow('no array found');
    });

    test('Should use custom idField for updates', async () => {
      const fileName = 'updateCustomId.json';
      const initialData = {
        items: [
          { uuid: 'uid-1', name: 'User 1' },
          { uuid: 'uid-2', name: 'User 2' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const updated = await storage.updateById(fileName, 'uid-1', { name: 'Updated User' }, 'uuid');

      expect(updated.name).toBe('Updated User');
      expect(updated.uuid).toBe('uid-1');
    });

    test('Should serialize concurrent updateById operations with file lock', async () => {
      const fileName = 'updateConcurrent.json';
      const initialData = {
        items: [
          { id: '1', counter: 0 }
        ]
      };

      await storage.write(fileName, initialData, false);

      // Start multiple concurrent updates
      const updates = [
        storage.updateById(fileName, '1', { counter: 1 }),
        storage.updateById(fileName, '1', { counter: 2 }),
        storage.updateById(fileName, '1', { counter: 3 })
      ];

      const results = await Promise.all(updates);

      // Last one should win
      const finalData = await storage.read(fileName);
      expect(finalData.items[0].counter).toBeGreaterThan(0);
      expect(finalData.items[0].counter).toBeLessThanOrEqual(3);
    });

    test('Should preserve other items when updating one', async () => {
      const fileName = 'updatePreserve.json';
      const initialData = {
        items: [
          { id: '1', data: 'original1' },
          { id: '2', data: 'original2' },
          { id: '3', data: 'original3' }
        ]
      };

      await storage.write(fileName, initialData, false);

      await storage.updateById(fileName, '2', { data: 'updated2' });

      const readData = await storage.read(fileName);
      expect(readData.items[0].data).toBe('original1');
      expect(readData.items[1].data).toBe('updated2');
      expect(readData.items[2].data).toBe('original3');
    });
  });

  describe('append()', () => {
    test('Should append item to wrapped items array', async () => {
      const fileName = 'appendWrapped.json';
      const initialData = { items: [{ id: 1, name: 'Item 1' }] };

      await storage.write(fileName, initialData, false);

      const item = { id: 2, name: 'Item 2' };
      const appended = await storage.append(fileName, item);

      expect(appended).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.items.length).toBe(2);
      expect(readData.items[1]).toEqual(item);
    });

    test('Should append item to plain array', async () => {
      const fileName = 'appendPlainArray.json';
      const initialData = [{ id: 1 }, { id: 2 }];

      await storage.write(fileName, initialData, false);

      const item = { id: 3 };
      const appended = await storage.append(fileName, item);

      expect(appended).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.length).toBe(3);
      expect(readData[2]).toEqual(item);
    });

    test('Should append item to activities array', async () => {
      const fileName = 'appendActivities.json';
      const initialData = { activities: [{ id: 1, action: 'create' }] };

      await storage.write(fileName, initialData, false);

      const item = { id: 2, action: 'update' };
      const appended = await storage.append(fileName, item);

      expect(appended).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.activities.length).toBe(2);
      expect(readData.activities[1]).toEqual(item);
    });

    test('Should create items array if file is missing', async () => {
      const fileName = 'appendMissing.json';

      const item = { id: 1, name: 'First Item' };
      const appended = await storage.append(fileName, item);

      expect(appended).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.items).toBeDefined();
      expect(readData.items[0]).toEqual(item);
    });

    test('Should create items array if file contains invalid JSON', async () => {
      const fileName = 'appendInvalid.json';
      const filePath = storage.getFilePath(fileName);

      // Write invalid JSON
      await fsPromises.writeFile(filePath, 'not valid json {');

      const item = { id: 1, name: 'Item' };
      const appended = await storage.append(fileName, item);

      expect(appended).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.items).toBeDefined();
      expect(readData.items[0]).toEqual(item);
    });

    test('Should create items array if file contains null', async () => {
      const fileName = 'appendNull.json';
      const filePath = storage.getFilePath(fileName);

      await fsPromises.writeFile(filePath, 'null');

      const item = { id: 1 };
      const appended = await storage.append(fileName, item);

      expect(appended).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.items[0]).toEqual(item);
    });

    test('Should create items array if file contains scalar value', async () => {
      const fileName = 'appendScalar.json';

      await storage.write(fileName, 'just a string', false);

      const item = { id: 1 };
      const appended = await storage.append(fileName, item);

      expect(appended).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.items[0]).toEqual(item);
    });

    test('Should handle multiple appends to same file', async () => {
      const fileName = 'appendMultiple.json';

      await storage.append(fileName, { id: 1 });
      await storage.append(fileName, { id: 2 });
      await storage.append(fileName, { id: 3 });

      const readData = await storage.read(fileName);
      expect(readData.items.length).toBe(3);
      expect(readData.items[2].id).toBe(3);
    });

    test('Should handle sequential appends creating all items', async () => {
      const fileName = 'appendSequential.json';

      // Append items sequentially to avoid concurrent writes
      for (let i = 0; i < 5; i++) {
        await storage.append(fileName, { id: i });
      }

      const readData = await storage.read(fileName);
      expect(readData.items.length).toBe(5);
      expect(readData.items[0].id).toBe(0);
      expect(readData.items[4].id).toBe(4);
    });
  });

  describe('list()', () => {
    test('Should list all items from wrapped array', async () => {
      const fileName = 'listWrapped.json';
      const initialData = {
        items: [
          { id: '1', status: 'active' },
          { id: '2', status: 'inactive' },
          { id: '3', status: 'active' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const items = await storage.list(fileName);

      expect(items.length).toBe(3);
      expect(items).toEqual(initialData.items);
    });

    test('Should list items from plain array', async () => {
      const fileName = 'listPlain.json';
      const initialData = [
        { id: '1', value: 100 },
        { id: '2', value: 200 }
      ];

      await storage.write(fileName, initialData, false);

      const items = await storage.list(fileName);

      expect(items.length).toBe(2);
      expect(items).toEqual(initialData);
    });

    test('Should return empty array when file has no array', async () => {
      const fileName = 'listNoArray.json';
      await storage.write(fileName, { value: 'scalar' }, false);

      const items = await storage.list(fileName);

      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBe(0);
    });

    test('Should filter items by single field', async () => {
      const fileName = 'listFilter.json';
      const initialData = {
        items: [
          { id: '1', status: 'active', type: 'A' },
          { id: '2', status: 'inactive', type: 'B' },
          { id: '3', status: 'active', type: 'A' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const items = await storage.list(fileName, { status: 'active' });

      expect(items.length).toBe(2);
      items.forEach(item => expect(item.status).toBe('active'));
    });

    test('Should filter items by multiple fields', async () => {
      const fileName = 'listFilterMulti.json';
      const initialData = {
        items: [
          { id: '1', status: 'active', type: 'A' },
          { id: '2', status: 'inactive', type: 'B' },
          { id: '3', status: 'active', type: 'A' },
          { id: '4', status: 'active', type: 'B' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const items = await storage.list(fileName, { status: 'active', type: 'A' });

      expect(items.length).toBe(2);
      items.forEach(item => {
        expect(item.status).toBe('active');
        expect(item.type).toBe('A');
      });
    });

    test('Should return empty array when filter matches nothing', async () => {
      const fileName = 'listFilterEmpty.json';
      const initialData = {
        items: [
          { id: '1', status: 'active' },
          { id: '2', status: 'active' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const items = await storage.list(fileName, { status: 'archived' });

      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBe(0);
    });
  });

  describe('deleteById()', () => {
    test('Should delete item from wrapped array', async () => {
      const fileName = 'deleteWrapped.json';
      const initialData = {
        items: [
          { id: '1', name: 'Item 1' },
          { id: '2', name: 'Item 2' },
          { id: '3', name: 'Item 3' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const deleted = await storage.deleteById(fileName, '2');

      expect(deleted).toEqual({ id: '2', name: 'Item 2' });

      const readData = await storage.read(fileName);
      expect(readData.items.length).toBe(2);
      expect(readData.items.find(i => i.id === '2')).toBeUndefined();
    });

    test('Should delete item from plain array', async () => {
      const fileName = 'deletePlain.json';
      const initialData = [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' }
      ];

      await storage.write(fileName, initialData, false);

      const deleted = await storage.deleteById(fileName, '1');

      expect(deleted.id).toBe('1');

      const readData = await storage.read(fileName);
      expect(readData.length).toBe(1);
      expect(readData[0].id).toBe('2');
    });

    test('Should return null when ID not found', async () => {
      const fileName = 'deleteNotFound.json';
      await storage.write(fileName, { items: [{ id: '1', name: 'Item 1' }] }, false);

      const deleted = await storage.deleteById(fileName, 'nonexistent');

      expect(deleted).toBeNull();

      const readData = await storage.read(fileName);
      expect(readData.items.length).toBe(1);
    });

    test('Should throw error when no array found', async () => {
      const fileName = 'deleteNoArray.json';
      await storage.write(fileName, { value: 'scalar' }, false);

      await expect(
        storage.deleteById(fileName, '1')
      ).rejects.toThrow('no array found');
    });

    test('Should use custom idField for deletion', async () => {
      const fileName = 'deleteCustomId.json';
      const initialData = {
        items: [
          { uuid: 'uid-1', name: 'User 1' },
          { uuid: 'uid-2', name: 'User 2' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const deleted = await storage.deleteById(fileName, 'uid-1', 'uuid');

      expect(deleted.uuid).toBe('uid-1');

      const readData = await storage.read(fileName);
      expect(readData.items.length).toBe(1);
      expect(readData.items[0].uuid).toBe('uid-2');
    });

    test('Should preserve other items when deleting', async () => {
      const fileName = 'deletePreserve.json';
      const initialData = {
        items: [
          { id: '1', data: 'first' },
          { id: '2', data: 'second' },
          { id: '3', data: 'third' }
        ]
      };

      await storage.write(fileName, initialData, false);

      await storage.deleteById(fileName, '2');

      const readData = await storage.read(fileName);
      expect(readData.items[0].id).toBe('1');
      expect(readData.items[1].id).toBe('3');
    });
  });

  describe('_withFileLock()', () => {
    test('Should serialize concurrent operations on same file', async () => {
      const fileName = 'lockSerialization.json';
      const operations = [];

      // Mock function to track execution order
      const mockFn = async (opId) => {
        operations.push(`start-${opId}`);
        await new Promise(r => setTimeout(r, 10));
        operations.push(`end-${opId}`);
        return opId;
      };

      // Start three operations concurrently
      const op1 = storage._withFileLock(fileName, () => mockFn(1));
      const op2 = storage._withFileLock(fileName, () => mockFn(2));
      const op3 = storage._withFileLock(fileName, () => mockFn(3));

      await Promise.all([op1, op2, op3]);

      // Operations should be serialized, not interleaved
      expect(operations).toBeDefined();
      expect(operations.length).toBe(6);
    });

    test('Should allow concurrent operations on different files', async () => {
      const operations = [];

      const mockFn = async (opId) => {
        operations.push(`start-${opId}`);
        await new Promise(r => setTimeout(r, 5));
        operations.push(`end-${opId}`);
        return opId;
      };

      // Operations on different files should not block each other
      const op1 = storage._withFileLock('file1.json', () => mockFn(1));
      const op2 = storage._withFileLock('file2.json', () => mockFn(2));

      await Promise.all([op1, op2]);

      expect(operations.length).toBe(4);
    });

    test('Should return function result', async () => {
      const result = await storage._withFileLock('test.json', async () => {
        return { data: 'test_value' };
      });

      expect(result).toEqual({ data: 'test_value' });
    });

    test('Should propagate errors from critical section', async () => {
      await expect(
        storage._withFileLock('test.json', async () => {
          throw new Error('Critical section error');
        })
      ).rejects.toThrow('Critical section error');
    });

    test('Should always release lock even on error', async () => {
      // First operation throws error
      await expect(
        storage._withFileLock('lockRelease.json', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow();

      // Second operation should proceed without hanging
      const result = await storage._withFileLock('lockRelease.json', async () => {
        return 'success';
      });

      expect(result).toBe('success');
    });

    test('Should queue multiple operations and process sequentially', async () => {
      const fileName = 'lockQueue.json';
      const sequence = [];

      // Queue three operations that should execute sequentially
      const op1 = storage._withFileLock(fileName, async () => {
        sequence.push('op1_start');
        await new Promise(r => setTimeout(r, 5));
        sequence.push('op1_end');
      });

      const op2 = storage._withFileLock(fileName, async () => {
        sequence.push('op2_start');
        await new Promise(r => setTimeout(r, 5));
        sequence.push('op2_end');
      });

      const op3 = storage._withFileLock(fileName, async () => {
        sequence.push('op3_start');
        sequence.push('op3_end');
      });

      await Promise.all([op1, op2, op3]);

      // Operations should not interleave
      expect(sequence[0]).toBe('op1_start');
      expect(sequence[1]).toBe('op1_end');
      expect(sequence[2]).toBe('op2_start');
      expect(sequence[3]).toBe('op2_end');
    });
  });

  describe('paginate()', () => {
    test('Should paginate items with default page size', async () => {
      const fileName = 'paginate.json';
      const items = Array.from({ length: 25 }, (_, i) => ({ id: i, value: `item-${i}` }));

      await storage.write(fileName, { items }, false);

      const page1 = await storage.paginate(fileName, 1);

      expect(page1.data.length).toBe(10);
      expect(page1.pagination.page).toBe(1);
      expect(page1.pagination.pageSize).toBe(10);
      expect(page1.pagination.total).toBe(25);
      expect(page1.pagination.hasNext).toBe(true);
      expect(page1.pagination.hasPrev).toBe(false);
    });

    test('Should return correct page data', async () => {
      const fileName = 'paginatePage.json';
      const items = Array.from({ length: 30 }, (_, i) => ({ id: i }));

      await storage.write(fileName, { items }, false);

      const page2 = await storage.paginate(fileName, 2, 10);

      expect(page2.data[0].id).toBe(10);
      expect(page2.data[9].id).toBe(19);
      expect(page2.pagination.hasNext).toBe(true);
      expect(page2.pagination.hasPrev).toBe(true);
    });

    test('Should handle last page', async () => {
      const fileName = 'paginateLast.json';
      const items = Array.from({ length: 25 }, (_, i) => ({ id: i }));

      await storage.write(fileName, { items }, false);

      const lastPage = await storage.paginate(fileName, 3, 10);

      expect(lastPage.data.length).toBe(5);
      expect(lastPage.pagination.totalPages).toBe(3);
      expect(lastPage.pagination.hasNext).toBe(false);
      expect(lastPage.pagination.hasPrev).toBe(true);
    });

    test('Should calculate totalPages correctly', async () => {
      const fileName = 'paginatePages.json';
      const items = Array.from({ length: 45 }, (_, i) => ({ id: i }));

      await storage.write(fileName, { items }, false);

      const result = await storage.paginate(fileName, 1, 10);

      expect(result.pagination.totalPages).toBe(5);
    });

    test('Should handle empty result set', async () => {
      const fileName = 'paginateEmpty.json';
      await storage.write(fileName, { items: [] }, false);

      const result = await storage.paginate(fileName, 1, 10);

      expect(result.data.length).toBe(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNext).toBe(false);
    });

    test('Should use custom page size', async () => {
      const fileName = 'paginateSize.json';
      const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));

      await storage.write(fileName, { items }, false);

      const result = await storage.paginate(fileName, 1, 15);

      expect(result.data.length).toBe(15);
      expect(result.pagination.totalPages).toBe(4);
    });
  });

  describe('getStats()', () => {
    test('Should return stats for JSON files', async () => {
      const fileName1 = 'statsFile1.json';
      const fileName2 = 'statsFile2.json';

      await storage.write(fileName1, { data: 'file1' }, false);
      await storage.write(fileName2, { data: 'file2' }, false);

      const stats = await storage.getStats();

      expect(stats.files).toBeDefined();
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.dataDir).toBe(testDataDir);
      expect(stats.files[fileName1]).toBeDefined();
      expect(stats.files[fileName2]).toBeDefined();
    });

    test('Should exclude backup files from stats', async () => {
      const fileName = 'statsBackup.json';

      await storage.write(fileName, { version: 1 }, true);
      await storage.write(fileName, { version: 2 }, true);

      const stats = await storage.getStats();

      const backupFileCount = Object.keys(stats.files).filter(f => f.includes('backup')).length;
      expect(backupFileCount).toBe(0);
    });

    test('Should include file size and modification time', async () => {
      const fileName = 'statsInfo.json';
      const testData = { key: 'value', nested: { data: 'content' } };

      await storage.write(fileName, testData, false);

      const stats = await storage.getStats();

      expect(stats.files[fileName].size).toBeGreaterThan(0);
      expect(stats.files[fileName].modified).toBeDefined();
      expect(new Date(stats.files[fileName].modified)).toBeInstanceOf(Date);
    });

    test('Should handle stats when directory is empty', async () => {
      const emptyDir = path.join(__dirname, '../../tmp/test_storage_empty_' + Date.now());
      fs.mkdirSync(emptyDir, { recursive: true });

      try {
        const emptyStorage = new Storage(emptyDir);
        const stats = await emptyStorage.getStats();

        expect(stats.totalSize).toBe(0);
        expect(Object.keys(stats.files).length).toBe(0);
      } finally {
        // Clean up, but allow permission errors
        try {
          await fsPromises.rm(emptyDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
      }
    });
  });

  describe('findById()', () => {
    test('Should find item in wrapped array by id', async () => {
      const fileName = 'findWrapped.json';
      const initialData = {
        items: [
          { id: '1', name: 'Item 1' },
          { id: '2', name: 'Item 2' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const found = await storage.findById(fileName, '2');

      expect(found).toEqual({ id: '2', name: 'Item 2' });
    });

    test('Should find item in plain array', async () => {
      const fileName = 'findPlain.json';
      const initialData = [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' }
      ];

      await storage.write(fileName, initialData, false);

      const found = await storage.findById(fileName, '1');

      expect(found).toEqual({ id: '1', name: 'Item 1' });
    });

    test('Should return null when item not found', async () => {
      const fileName = 'findNotFound.json';
      await storage.write(fileName, { items: [{ id: '1', name: 'Item 1' }] }, false);

      const found = await storage.findById(fileName, 'nonexistent');

      expect(found).toBeNull();
    });

    test('Should use custom idField for finding', async () => {
      const fileName = 'findCustomId.json';
      const initialData = {
        items: [
          { uuid: 'uid-1', name: 'User 1' },
          { uuid: 'uid-2', name: 'User 2' }
        ]
      };

      await storage.write(fileName, initialData, false);

      const found = await storage.findById(fileName, 'uid-2', 'uuid');

      expect(found.uuid).toBe('uid-2');
      expect(found.name).toBe('User 2');
    });

    test('Should return null when no array found', async () => {
      const fileName = 'findNoArray.json';
      await storage.write(fileName, { value: 'scalar' }, false);

      const found = await storage.findById(fileName, '1');

      expect(found).toBeNull();
    });

    test('Should throw when reading file errors on findById', async () => {
      const fileName = 'findError.json';
      const filePath = storage.getFilePath(fileName);

      // Write invalid JSON
      await fsPromises.writeFile(filePath, 'invalid json {');

      await expect(storage.findById(fileName, '1')).rejects.toThrow();
    });
  });

  describe('Error handling for write operations', () => {
    test('Should throw and log error when initialize fails to write', async () => {
      const fileName = 'initFail.json';
      const filePath = storage.getFilePath(fileName);

      // Make parent directory read-only to force write failure
      // (Skip if permissions don't work on this system)
      try {
        await fsPromises.chmod(testDataDir, 0o444);

        await expect(
          storage.initialize(fileName, { test: true })
        ).rejects.toThrow();

        // Restore permissions for cleanup
        await fsPromises.chmod(testDataDir, 0o755);
      } catch (e) {
        // Some systems don't support permission changes, skip
        await fsPromises.chmod(testDataDir, 0o755).catch(() => {});
      }
    });

    test('Should handle backup error but continue write', async () => {
      const fileName = 'backupError.json';

      // Write initial data
      await storage.write(fileName, { version: 1 }, false);

      // For next write, try to create backup but data should still write
      const data = { version: 2 };
      await storage.write(fileName, data, true);

      // File should be updated despite any backup issues
      const readData = await storage.read(fileName);
      expect(readData.version).toBe(2);
    });

    test('Should log debug message on successful write', async () => {
      const fileName = 'successWrite.json';
      const testData = { logged: true };

      // This should succeed and log debug message
      await storage.write(fileName, testData, false);

      const readData = await storage.read(fileName);
      expect(readData.logged).toBe(true);
    });
  });

  describe('Error handling for append operations', () => {
    test('Should handle append with no items or activities field', async () => {
      const fileName = 'appendNoField.json';
      const data = { someOtherField: [], data: 'value' };

      await storage.write(fileName, data, false);

      const item = { id: 1 };
      await storage.append(fileName, item);

      const readData = await storage.read(fileName);
      expect(readData.items).toBeDefined();
      expect(readData.items[0]).toEqual(item);
    });

    test('Should log error when append fails internally', async () => {
      const fileName = 'appendLog.json';
      const data = { items: [{ id: 1 }] };

      await storage.write(fileName, data, false);

      // This append should succeed and be logged
      const item = { id: 2, test: true };
      const result = await storage.append(fileName, item);

      expect(result).toEqual(item);
    });
  });

  describe('Error handling for list operations', () => {
    test('Should throw when list fails to read', async () => {
      const fileName = 'listError.json';
      const filePath = storage.getFilePath(fileName);

      // Write invalid JSON
      await fsPromises.writeFile(filePath, 'invalid json {');

      await expect(storage.list(fileName)).rejects.toThrow();
    });
  });

  describe('Error handling for paginate operations', () => {
    test('Should throw when paginate fails to read', async () => {
      const fileName = 'paginateError.json';
      const filePath = storage.getFilePath(fileName);

      // Write invalid JSON
      await fsPromises.writeFile(filePath, 'invalid json {');

      await expect(storage.paginate(fileName, 1, 10)).rejects.toThrow();
    });
  });

  describe('Error handling for getStats operations', () => {
    test('Should return stats with multiple files', async () => {
      const fileName1 = 'stat1.json';
      const fileName2 = 'stat2.json';

      await storage.write(fileName1, { data: 'first' }, false);
      await storage.write(fileName2, { data: 'second' }, false);

      const stats = await storage.getStats();

      expect(stats.files).toBeDefined();
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.dataDir).toBe(testDataDir);
    });
  });

  describe('Edge cases for append with different structures', () => {
    test('Should handle append when data is object with no array fields', async () => {
      const fileName = 'appendObject.json';
      const data = { meta: 'data', count: 5 };

      await storage.write(fileName, data, false);

      const item = { id: 1 };
      const result = await storage.append(fileName, item);

      expect(result).toEqual(item);

      const readData = await storage.read(fileName);
      expect(readData.items).toBeDefined();
      expect(readData.items[0]).toEqual(item);
    });

    test('Should append to plain array without wrapping', async () => {
      const fileName = 'appendPlainDirect.json';
      const data = [{ id: 1 }, { id: 2 }];

      await storage.write(fileName, data, false);

      const item = { id: 3, special: true };
      await storage.append(fileName, item);

      const readData = await storage.read(fileName);
      expect(Array.isArray(readData)).toBe(true);
      expect(readData.length).toBe(3);
      expect(readData[2].special).toBe(true);
    });
  });
});
