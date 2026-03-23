#!/usr/bin/env node
/**
 * Migrate JSON file storage → SQLite database.
 * Run once: node scripts/migrateToSqlite.js
 *
 * Safe to run multiple times — inserts are skipped for existing IDs.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');

async function migrate() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  JSON → SQLite Migration');
  console.log('═══════════════════════════════════════════');
  console.log('');

  // Initialize database
  const db = require('../utils/database');
  await db.initDatabase();

  let migrated = 0;
  let skipped = 0;

  // ── Jobs ────────────────────────────────────────────────
  const jobsPath = path.join(DATA_DIR, 'jobs.json');
  if (fs.existsSync(jobsPath)) {
    const data = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'));
    const jobs = data.jobs || [];
    console.log(`▸ jobs.json: ${jobs.length} records`);
    for (const job of jobs) {
      try {
        if (!db.jobs.getById(job.id)) {
          db.jobs.create(job);
          migrated++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(`  ⚠ Skipped job ${job.id}: ${err.message}`);
        skipped++;
      }
    }
  }

  // ── Activity ────────────────────────────────────────────
  const activityPath = path.join(DATA_DIR, 'activity.json');
  if (fs.existsSync(activityPath)) {
    const data = JSON.parse(fs.readFileSync(activityPath, 'utf-8'));
    const activities = data.activities || data.items || [];
    console.log(`▸ activity.json: ${activities.length} records`);
    for (const entry of activities) {
      try {
        db.activity.append(entry);
        migrated++;
      } catch (err) {
        skipped++;
      }
    }
  }

  // ── Invoices ────────────────────────────────────────────
  const invoicesPath = path.join(DATA_DIR, 'invoices.json');
  if (fs.existsSync(invoicesPath)) {
    const data = JSON.parse(fs.readFileSync(invoicesPath, 'utf-8'));
    const invs = data.invoices || [];
    console.log(`▸ invoices.json: ${invs.length} records`);
    for (const inv of invs) {
      try {
        if (!db.invoices.getById(inv.id)) {
          db.invoices.create(inv);
          migrated++;
        } else {
          skipped++;
        }
      } catch (err) {
        skipped++;
      }
    }
  }

  // ── Ledger ──────────────────────────────────────────────
  const ledgerPath = path.join(DATA_DIR, 'ledger.json');
  if (fs.existsSync(ledgerPath)) {
    const data = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    const entries = data.transactions || data.entries || [];
    console.log(`▸ ledger.json: ${entries.length} records`);
    for (const entry of entries) {
      try {
        db.ledger.append(entry);
        migrated++;
      } catch (err) {
        skipped++;
      }
    }
  }

  // ── Portfolio ───────────────────────────────────────────
  const portfolioPath = path.join(DATA_DIR, 'portfolio.json');
  if (fs.existsSync(portfolioPath)) {
    const data = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
    await db.writeData('portfolio.json', data);
    console.log(`▸ portfolio.json: migrated to kv_store`);
    migrated++;
  }

  // ── Niches ──────────────────────────────────────────────
  const nichesPath = path.join(DATA_DIR, 'niches.json');
  if (fs.existsSync(nichesPath)) {
    const data = JSON.parse(fs.readFileSync(nichesPath, 'utf-8'));
    await db.writeData('niches.json', data);
    console.log(`▸ niches.json: migrated to kv_store`);
    migrated++;
  }

  // ── Approvals ───────────────────────────────────────────
  const approvalsPath = path.join(DATA_DIR, 'approvals.json');
  if (fs.existsSync(approvalsPath)) {
    const data = JSON.parse(fs.readFileSync(approvalsPath, 'utf-8'));
    await db.writeData('approvals.json', data);
    console.log(`▸ approvals.json: migrated to kv_store`);
    migrated++;
  }

  // ── Metrics ─────────────────────────────────────────────
  const metricsPath = path.join(DATA_DIR, 'metrics.json');
  if (fs.existsSync(metricsPath)) {
    const data = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    await db.writeData('metrics.json', data);
    console.log(`▸ metrics.json: migrated to kv_store`);
    migrated++;
  }

  db.persist();

  console.log('');
  console.log('───────────────────────────────────────────');
  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
  console.log(`  Database: ${path.join(DATA_DIR, 'agency.db')}`);
  console.log('───────────────────────────────────────────');
  console.log('');
  console.log('  To switch over, set USE_SQLITE=true in your .env');
  console.log('  JSON files are preserved as a backup.');
  console.log('');

  db.closeDatabase();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
