/**
 * SQLite Database Layer
 * Drop-in replacement for JSON file storage using sql.js (pure-JS SQLite).
 *
 * The module exposes the same API surface as storage.js so existing code
 * needs minimal changes. Internally it uses a single SQLite database file
 * at data/agency.db.
 *
 * Design:
 *   - Typed tables for structured data (jobs, invoices, etc.)
 *   - Generic key-value fallback for unstructured JSON files
 *   - All reads/writes are synchronous (sql.js) — matches the Node event
 *     loop model and avoids the concurrency issues of JSON file I/O
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const logger = require('./logger');

let db = null;
let SQL = null;
const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'agency.db');

// ── Initialization ──────────────────────────────────────────────────

async function initDatabase() {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    logger.info('[Database] Loaded existing database', { path: DB_PATH });
  } else {
    db = new SQL.Database();
    logger.info('[Database] Created new database', { path: DB_PATH });
  }

  // Enable WAL mode for better concurrent read performance
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  createTables();
  persist();

  return db;
}

function persist() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);

  // Atomic write: write to temp file, then rename over the original.
  // If interrupted, the original file remains intact.
  const tmpPath = DB_PATH + '.tmp';
  try {
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, DB_PATH);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    logger.error('[Database] persist() failed', { error: err.message });
    throw err;
  }
}

// ── Schema ──────────────────────────────────────────────────────────

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'content',
      state TEXT NOT NULL DEFAULT 'DISCOVERED',
      title TEXT,
      topic TEXT,
      priority INTEGER DEFAULT 0,
      deadline TEXT,
      data TEXT,
      content TEXT,
      brief TEXT,
      client_name TEXT,
      client_email TEXT,
      agent_results TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      last_transition_from TEXT,
      last_transition_to TEXT,
      last_transition_at TEXT,
      completion_status TEXT,
      invoice_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      completed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      agent TEXT,
      job_id TEXT,
      action TEXT,
      status TEXT,
      details TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      client_name TEXT,
      client_email TEXT,
      line_items TEXT,
      subtotal REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      billing_model TEXT DEFAULT 'per_piece',
      status TEXT DEFAULT 'draft',
      issued_at TEXT,
      due_at TEXT,
      paid_at TEXT,
      stripe_invoice_id TEXT,
      stripe_payment_intent_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT,
      amount REAL DEFAULT 0,
      invoice_id TEXT,
      job_id TEXT,
      client TEXT,
      description TEXT,
      status TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      title TEXT,
      content TEXT,
      type TEXT,
      niche TEXT,
      quality_score REAL,
      created_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      reviewed_at TEXT,
      created_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS niches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS metrics (
      key TEXT PRIMARY KEY,
      value REAL DEFAULT 0,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      master_password TEXT NOT NULL,
      algorithm TEXT DEFAULT 'bcrypt',
      salt_rounds INTEGER DEFAULT 10,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  // Generic key-value store for any unstructured data
  db.run(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    )
  `);

  // Indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state)');
  db.run('CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_activity_job ON activity(job_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_job ON ledger(job_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger(type)');

  logger.info('[Database] Schema ready');
}

// ── Jobs ────────────────────────────────────────────────────────────

const jobs = {
  create(job) {
    const stmt = db.prepare(`
      INSERT INTO jobs (id, type, state, title, topic, priority, deadline, data,
        content, brief, client_name, client_email, agent_results, retry_count,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      job.id, job.type || 'content', job.state || 'DISCOVERED',
      job.title || job.data?.topic || null, job.topic || job.data?.topic || null,
      job.priority || 0, job.deadline || null,
      JSON.stringify(job.data || {}),
      typeof job.content === 'string' ? job.content : JSON.stringify(job.content || null),
      JSON.stringify(job.brief || null),
      job.data?.client || job.client?.name || null,
      job.client?.email || job.data?.clientEmail || null,
      JSON.stringify(job.agentResults || {}),
      job.retryCount || 0,
      job.createdAt || new Date().toISOString(),
      new Date().toISOString()
    ]);
    stmt.free();
    persist();
    return job;
  },

  getById(id) {
    const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    stmt.bind([id]);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row ? deserializeJob(row) : null;
  },

  list(filters = {}) {
    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params = [];

    if (filters.state) { sql += ' AND state = ?'; params.push(filters.state); }
    if (filters.type) { sql += ' AND type = ?'; params.push(filters.type); }
    if (filters.status === 'active') { sql += ' AND completed_at IS NULL'; }
    if (filters.status === 'completed') { sql += ' AND completion_status = ?'; params.push('success'); }
    if (filters.status === 'failed') { sql += ' AND state IN (?, ?)'; params.push('FAILED', 'DEAD_LETTER'); }

    sql += ` ORDER BY ${filters.sort === 'oldest' ? 'created_at ASC' : 'created_at DESC'}`;
    if (filters.limit) { sql += ' LIMIT ?'; params.push(parseInt(filters.limit, 10)); }

    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(deserializeJob(stmt.getAsObject()));
    stmt.free();
    return rows;
  },

  update(id, updates) {
    // NOTE: sql.js is synchronous within a single Node.js event-loop tick, so
    // the read→merge→write below is atomic as long as callers don't yield between
    // calls.  We re-read inside the same sync block to prevent stale-data merges.
    const job = this.getById(id);
    if (!job) return null;

    const merged = { ...job, ...updates, updatedAt: new Date().toISOString() };
    const stmt = db.prepare(`
      UPDATE jobs SET state = ?, title = ?, topic = ?, priority = ?, content = ?,
        brief = ?, agent_results = ?, retry_count = ?, last_error = ?,
        last_transition_from = ?, last_transition_to = ?, last_transition_at = ?,
        completion_status = ?, invoice_id = ?, completed_at = ?, updated_at = ?,
        data = ?, client_name = ?, client_email = ?
      WHERE id = ?
    `);
    stmt.run([
      merged.state, merged.title, merged.topic, merged.priority,
      typeof merged.content === 'string' ? merged.content : JSON.stringify(merged.content),
      JSON.stringify(merged.brief),
      JSON.stringify(merged.agentResults || {}),
      merged.retryCount || 0, merged.lastError || null,
      merged.lastTransition?.from || null, merged.lastTransition?.to || null,
      merged.lastTransition?.timestamp || merged.lastTransition?.at || null,
      merged.completionStatus || null, merged.invoiceId || null,
      merged.completedAt || null, merged.updatedAt,
      JSON.stringify(merged.data || {}),
      merged.data?.client || merged.clientName || null,
      merged.clientEmail || null,
      id
    ]);
    stmt.free();
    persist();
    return merged;
  },

  delete(id) {
    db.run('DELETE FROM jobs WHERE id = ?', [id]);
    persist();
  },

  count(filters = {}) {
    let sql = 'SELECT COUNT(*) as count FROM jobs WHERE 1=1';
    const params = [];
    if (filters.state) { sql += ' AND state = ?'; params.push(filters.state); }
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    stmt.step();
    const count = stmt.getAsObject().count;
    stmt.free();
    return count;
  }
};

function deserializeJob(row) {
  return {
    id: row.id,
    type: row.type,
    state: row.state,
    title: row.title,
    topic: row.topic,
    priority: row.priority,
    deadline: row.deadline,
    data: safeJsonParse(row.data, {}),
    content: safeJsonParse(row.content, row.content), // may be string or object
    brief: safeJsonParse(row.brief, null),
    clientName: row.client_name,
    clientEmail: row.client_email,
    agentResults: safeJsonParse(row.agent_results, {}),
    retryCount: row.retry_count,
    lastError: row.last_error,
    lastTransition: row.last_transition_to ? {
      from: row.last_transition_from,
      to: row.last_transition_to,
      timestamp: row.last_transition_at
    } : null,
    completionStatus: row.completion_status,
    invoiceId: row.invoice_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

// ── Activity ────────────────────────────────────────────────────────

const activity = {
  append(entry) {
    const stmt = db.prepare(`
      INSERT INTO activity (timestamp, agent, job_id, action, status, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      entry.timestamp || new Date().toISOString(),
      entry.agent || null,
      entry.jobId || entry.job_id || null,
      entry.action || null,
      entry.status || null,
      JSON.stringify(entry)
    ]);
    stmt.free();
    persist();
    return entry;
  },

  list(limit = 50) {
    const stmt = db.prepare('SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?');
    stmt.bind([limit]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(safeJsonParse(row.details, row));
    }
    stmt.free();
    return rows;
  }
};

// ── Invoices ────────────────────────────────────────────────────────

const invoices = {
  create(invoice) {
    const stmt = db.prepare(`
      INSERT INTO invoices (id, job_id, client_name, client_email, line_items,
        subtotal, tax, total, currency, billing_model, status, issued_at,
        due_at, paid_at, stripe_invoice_id, stripe_payment_intent_id, notes,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      invoice.id, invoice.jobId || null,
      invoice.client?.name || null, invoice.client?.email || null,
      JSON.stringify(invoice.lineItems || []),
      invoice.subtotal || 0, invoice.tax || 0, invoice.total || 0,
      invoice.currency || 'USD', invoice.billingModel || 'per_piece',
      invoice.status || 'draft', invoice.issuedAt || null,
      invoice.dueAt || null, invoice.paidAt || null,
      invoice.stripeInvoiceId || null, invoice.stripePaymentIntentId || null,
      invoice.notes || null,
      invoice.createdAt || new Date().toISOString(),
      invoice.updatedAt || new Date().toISOString()
    ]);
    stmt.free();
    persist();
    return invoice;
  },

  getById(id) {
    const stmt = db.prepare('SELECT * FROM invoices WHERE id = ?');
    stmt.bind([id]);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row ? deserializeInvoice(row) : null;
  },

  list(filters = {}) {
    let sql = 'SELECT * FROM invoices WHERE 1=1';
    const params = [];
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters.jobId) { sql += ' AND job_id = ?'; params.push(filters.jobId); }
    if (filters.client) { sql += ' AND client_name LIKE ?'; params.push(`%${filters.client}%`); }
    sql += ' ORDER BY created_at DESC';

    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(deserializeInvoice(stmt.getAsObject()));
    stmt.free();
    return rows;
  },

  update(id, updates) {
    const invoice = this.getById(id);
    if (!invoice) return null;
    const merged = { ...invoice, ...updates, updatedAt: new Date().toISOString() };
    const stmt = db.prepare(`
      UPDATE invoices SET status = ?, paid_at = ?, stripe_invoice_id = ?,
        stripe_payment_intent_id = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run([
      merged.status, merged.paidAt || null,
      merged.stripeInvoiceId || null, merged.stripePaymentIntentId || null,
      merged.notes || null, merged.updatedAt, id
    ]);
    stmt.free();
    persist();
    return merged;
  },

  summary() {
    const all = this.list();
    const totalInvoiced = all.filter(i => !['cancelled', 'refunded'].includes(i.status))
      .reduce((s, i) => s + i.total, 0);
    const totalPaid = all.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
    const totalOutstanding = all.filter(i => ['draft', 'sent', 'overdue'].includes(i.status))
      .reduce((s, i) => s + i.total, 0);
    return {
      totalInvoiced: +totalInvoiced.toFixed(2),
      totalPaid: +totalPaid.toFixed(2),
      totalOutstanding: +totalOutstanding.toFixed(2),
      count: all.length
    };
  }
};

function deserializeInvoice(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    client: { name: row.client_name, email: row.client_email },
    lineItems: safeJsonParse(row.line_items, []),
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    currency: row.currency,
    billingModel: row.billing_model,
    status: row.status,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    paidAt: row.paid_at,
    stripeInvoiceId: row.stripe_invoice_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ── Ledger ──────────────────────────────────────────────────────────

const ledger = {
  append(entry) {
    const stmt = db.prepare(`
      INSERT INTO ledger (id, type, category, amount, invoice_id, job_id, client, description, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      entry.id, entry.type, entry.category || null, entry.amount || 0,
      entry.invoiceId || null, entry.jobId || null, entry.client || null,
      entry.description || null, entry.status || null,
      entry.timestamp || new Date().toISOString()
    ]);
    stmt.free();
    persist();
    return entry;
  },

  list(limit = 100) {
    const stmt = db.prepare('SELECT * FROM ledger ORDER BY timestamp DESC LIMIT ?');
    stmt.bind([limit]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },

  summary() {
    const revenue = db.exec("SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE type = 'revenue'");
    const payments = db.exec("SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE type = 'payment_received'");
    return {
      totalRevenue: revenue[0]?.values?.[0]?.[0] || 0,
      totalPayments: payments[0]?.values?.[0]?.[0] || 0
    };
  }
};

// ── Generic compatibility layer ─────────────────────────────────────
// Matches the old storage.js API so agents can keep using
// readData('jobs.json'), appendToArray('activity.json', item), etc.

const fileRouter = {
  'jobs.json': {
    read: () => ({ jobs: jobs.list() }),
    write: (data) => {
      if (data.jobs) data.jobs.forEach(j => {
        if (!jobs.getById(j.id)) jobs.create(j);
        else jobs.update(j.id, j);
      });
    },
    append: (item) => jobs.create(item)
  },
  'activity.json': {
    read: () => ({ activities: activity.list(200) }),
    write: (data) => {
      const items = data.activities || data.items || [];
      items.forEach(e => activity.append(e));
    },
    append: (item) => activity.append(item)
  },
  'invoices.json': {
    read: () => ({ invoices: invoices.list(), summary: invoices.summary() }),
    write: (data) => {
      if (data.invoices) data.invoices.forEach(inv => {
        if (!invoices.getById(inv.id)) invoices.create(inv);
        else invoices.update(inv.id, inv);
      });
    },
    append: (item) => invoices.create(item)
  },
  'ledger.json': {
    read: () => ({ transactions: ledger.list(), total: 0 }),
    write: (data) => {
      const entries = data.transactions || data.entries || [];
      entries.forEach(e => ledger.append(e));
    },
    append: (item) => ledger.append(item)
  }
};

// Fallback: store any other .json file as a key-value blob
function kvRead(fileName) {
  const stmt = db.prepare('SELECT value FROM kv_store WHERE key = ?');
  stmt.bind([fileName]);
  let result = null;
  if (stmt.step()) result = safeJsonParse(stmt.getAsObject().value, null);
  stmt.free();
  return result;
}

function kvWrite(fileName, data) {
  db.run(
    'INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)',
    [fileName, JSON.stringify(data), new Date().toISOString()]
  );
  persist();
}

// ── Public API (drop-in for storage.js) ─────────────────────────────

async function readData(fileName) {
  if (!db) await initDatabase();
  const router = fileRouter[fileName];
  if (router) return router.read();
  return kvRead(fileName);
}

async function writeData(fileName, data) {
  if (!db) await initDatabase();
  const router = fileRouter[fileName];
  if (router) { router.write(data); return true; }
  kvWrite(fileName, data);
  return true;
}

async function appendToArray(fileName, item) {
  if (!db) await initDatabase();
  const router = fileRouter[fileName];
  if (router) return router.append(item);
  // Fallback: read, append, write
  let data = kvRead(fileName);
  if (!data || typeof data !== 'object') data = { items: [] };
  const arr = data.items || data.activities || [];
  arr.push(item);
  kvWrite(fileName, data);
  return item;
}

async function findById(fileName, id) {
  if (!db) await initDatabase();
  if (fileName === 'jobs.json') return jobs.getById(id);
  if (fileName === 'invoices.json') return invoices.getById(id);
  // Fallback
  const data = await readData(fileName);
  if (!data) return null;
  const arr = data.items || data.jobs || data.invoices || [];
  return arr.find(item => item.id === id) || null;
}

async function updateById(fileName, id, updates) {
  if (!db) await initDatabase();
  if (fileName === 'jobs.json') return jobs.update(id, updates);
  if (fileName === 'invoices.json') return invoices.update(id, updates);
  return null;
}

async function deleteById(fileName, id) {
  if (!db) await initDatabase();
  if (fileName === 'jobs.json') { jobs.delete(id); return true; }
  return false;
}

async function listData(fileName, filter) {
  if (!db) await initDatabase();
  if (fileName === 'jobs.json') return jobs.list(filter || {});
  return readData(fileName);
}

async function initialize(fileName, defaultContent) {
  if (!db) await initDatabase();
  // Tables are created in initDatabase — this is a no-op for SQLite
  // but we initialize KV store for unstructured files
  const router = fileRouter[fileName];
  if (!router) {
    const existing = kvRead(fileName);
    if (!existing) kvWrite(fileName, defaultContent);
  }
}

// ── Utilities ───────────────────────────────────────────────────────

function safeJsonParse(str, fallback) {
  if (str === null || str === undefined) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function getStats() {
  if (!db) return {};
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const stats = {};
  if (tables[0]) {
    for (const row of tables[0].values) {
      const name = row[0];
      const count = db.exec(`SELECT COUNT(*) FROM ${name}`);
      stats[name] = { rows: count[0]?.values?.[0]?.[0] || 0 };
    }
  }
  return stats;
}

function closeDatabase() {
  if (db) {
    persist();
    db.close();
    db = null;
    logger.info('[Database] Closed');
  }
}

// ── Exports ─────────────────────────────────────────────────────────

module.exports = {
  initDatabase,
  closeDatabase,
  persist,
  getStats,
  // Typed accessors
  jobs,
  activity,
  invoices,
  ledger,
  // Drop-in storage.js compatibility
  readData,
  writeData,
  appendToArray,
  findById,
  updateById,
  deleteById,
  listData,
  initialize,
  // Singleton-style
  storage: {
    read: readData,
    write: writeData,
    append: appendToArray,
    findById,
    updateById,
    deleteById,
    list: listData,
    initialize,
    getStats,
    paginate: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    backupAll: () => { persist(); return true; },
    clearAll: () => { /* not implemented for safety */ }
  }
};
