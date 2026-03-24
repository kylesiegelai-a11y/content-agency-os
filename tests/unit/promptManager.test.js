process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn((p) => {
      if (p.includes('agents/prompts')) return true;
      return actualFs.existsSync(p);
    }),
    readdirSync: jest.fn((p) => {
      if (p.includes('agents/prompts')) return ['writer_v1.0.txt', 'writer_v2.0.txt', 'editor_v1.0.txt', 'briefer_v1.5.txt'];
      return actualFs.readdirSync(p);
    }),
    readFileSync: jest.fn((p, enc) => {
      if (p.includes('agents/prompts')) {
        if (p.includes('writer_v1.0')) return 'Write content v1';
        if (p.includes('writer_v2.0')) return 'Write content v2';
        if (p.includes('editor_v1.0')) return 'Edit content v1';
        if (p.includes('briefer_v1.5')) return 'Brief content v1.5';
      }
      return actualFs.readFileSync(p, enc);
    })
  };
});

const { PromptManager, getPromptManager, createPromptManager } = require('../../utils/promptManager');

describe('PromptManager', () => {
  let manager;

  beforeEach(() => {
    manager = new PromptManager();
  });

  describe('parsePromptKey', () => {
    test('parses writer_v1.0.txt to name and version', () => {
      const result = manager.parsePromptKey('writer_v1.0.txt');
      expect(result.name).toBe('writer');
      expect(result.version).toBe('1.0');
    });

    test('parses editor_v2.5.txt to name and version', () => {
      const result = manager.parsePromptKey('editor_v2.5.txt');
      expect(result.name).toBe('editor');
      expect(result.version).toBe('2.5');
    });

    test('handles filename without version with default version 1.0', () => {
      const result = manager.parsePromptKey('filename.txt');
      expect(result.name).toBe('filename');
      expect(result.version).toBe('1.0');
    });
  });

  describe('loadAllPrompts and getPrompt', () => {
    test('loads prompts from directory into cache', () => {
      manager.loadAllPrompts();
      expect(Object.keys(manager.promptCache).length).toBeGreaterThan(0);
    });

    test('getPrompt returns latest version when no version specified', () => {
      const prompt = manager.getPrompt('writer');
      expect(prompt).toBeDefined();
      expect(prompt.version).toBe('2.0');
      expect(prompt.content).toBe('Write content v2');
    });

    test('getPrompt returns specific version when version specified', () => {
      const prompt = manager.getPrompt('writer', '1.0');
      expect(prompt).toBeDefined();
      expect(prompt.version).toBe('1.0');
      expect(prompt.content).toBe('Write content v1');
    });

    test('getPrompt returns null for nonexistent prompt', () => {
      const prompt = manager.getPrompt('nonexistent');
      expect(prompt).toBeNull();
    });

    test('prompt object has content, version, filePath, loadedAt fields', () => {
      const prompt = manager.getPrompt('writer');
      expect(prompt.content).toBeDefined();
      expect(prompt.version).toBeDefined();
      expect(prompt.filePath).toBeDefined();
      expect(prompt.loadedAt).toBeDefined();
      expect(typeof prompt.loadedAt).toBe('string');
    });
  });

  describe('getVersions', () => {
    test('returns array of versions for existing prompt', () => {
      const versions = manager.getVersions('writer');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });

    test('returns empty array for nonexistent prompt', () => {
      const versions = manager.getVersions('nonexistent');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBe(0);
    });
  });

  describe('getLatestVersion', () => {
    test('returns highest version number for prompt', () => {
      const latest = manager.getLatestVersion('writer');
      expect(latest).toBe('2.0');
    });

    test('returns null for nonexistent prompt', () => {
      const latest = manager.getLatestVersion('nonexistent');
      expect(latest).toBeNull();
    });

    test('handles version comparison correctly', () => {
      const brieferVersions = manager.getVersions('briefer');
      const brieferLatest = manager.getLatestVersion('briefer');
      expect(brieferLatest).toBe('1.5');
    });
  });

  describe('listPrompts', () => {
    test('returns object with prompt names as keys', () => {
      const list = manager.listPrompts();
      expect(typeof list).toBe('object');
      expect(Object.keys(list).length).toBeGreaterThan(0);
    });

    test('each entry has versions array, latestVersion, count', () => {
      const list = manager.listPrompts();
      const firstPrompt = Object.values(list)[0];
      expect(Array.isArray(firstPrompt.versions)).toBe(true);
      expect(firstPrompt.latestVersion).toBeDefined();
      expect(typeof firstPrompt.count).toBe('number');
    });
  });

  describe('trackJobPromptVersion and getJobPromptVersions', () => {
    test('tracks version used for a job', () => {
      manager.trackJobPromptVersion('job-123', 'writer', '2.0');
      const tracked = manager.getJobPromptVersions('job-123');
      expect(tracked.writer.version).toBe('2.0');
      expect(tracked.writer.usedAt).toBeDefined();
    });

    test('returns tracked versions for a job', () => {
      manager.trackJobPromptVersion('job-456', 'editor', '1.0');
      manager.trackJobPromptVersion('job-456', 'briefer', '1.5');
      const tracked = manager.getJobPromptVersions('job-456');
      expect(tracked.editor.version).toBe('1.0');
      expect(tracked.briefer.version).toBe('1.5');
    });

    test('returns empty object for untracked job', () => {
      const tracked = manager.getJobPromptVersions('unknown-job');
      expect(typeof tracked).toBe('object');
      expect(Object.keys(tracked).length).toBe(0);
    });

    test('tracks multiple prompts per job', () => {
      manager.trackJobPromptVersion('job-789', 'writer', '1.0');
      manager.trackJobPromptVersion('job-789', 'editor', '1.0');
      manager.trackJobPromptVersion('job-789', 'briefer', '1.5');
      const tracked = manager.getJobPromptVersions('job-789');
      expect(Object.keys(tracked).length).toBe(3);
    });
  });

  describe('reload', () => {
    test('clears cache and reloads prompts', () => {
      const before = manager.getPrompt('writer');
      manager.reload();
      const after = manager.getPrompt('writer');
      expect(after).toBeDefined();
    });
  });

  describe('getStats', () => {
    test('returns promptTypes count', () => {
      const stats = manager.getStats();
      expect(typeof stats.promptTypes).toBe('number');
      expect(stats.promptTypes).toBeGreaterThan(0);
    });

    test('returns totalVersions count', () => {
      const stats = manager.getStats();
      expect(typeof stats.totalVersions).toBe('number');
      expect(stats.totalVersions).toBeGreaterThan(0);
    });

    test('returns jobsTracked count', () => {
      manager.trackJobPromptVersion('job-1', 'writer', '1.0');
      manager.trackJobPromptVersion('job-2', 'editor', '1.0');
      const stats = manager.getStats();
      expect(typeof stats.jobsTracked).toBe('number');
      expect(stats.jobsTracked).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getPromptManager and createPromptManager', () => {
    test('getPromptManager returns singleton', () => {
      const first = getPromptManager();
      const second = getPromptManager();
      expect(first).toBe(second);
    });

    test('createPromptManager returns new instance each time', () => {
      const first = createPromptManager();
      const second = createPromptManager();
      expect(first).not.toBe(second);
    });
  });
});
