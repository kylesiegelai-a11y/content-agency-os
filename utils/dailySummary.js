/**
 * Daily Summary — Generates operational summary for the solo operator.
 * What did the system do in the last 24 hours?
 */

const { getDailySummary: getOpsSummary } = require('./operationLog');
const { readData } = require('./storage');
const logger = require('./logger');

async function generateDailySummary(dateStr = null) {
  const today = dateStr || new Date().toISOString().slice(0, 10);

  // Operation stats
  const opsSummary = await getOpsSummary(today);

  // Job stats
  let jobStats = { total: 0, completed: 0, failed: 0, deadLettered: 0 };
  try {
    const jobsData = await readData('jobs.json');
    const jobs = (jobsData && jobsData.jobs) || [];
    const todayJobs = jobs.filter(j => j.createdAt && j.createdAt.startsWith(today));
    jobStats.total = todayJobs.length;
    jobStats.completed = todayJobs.filter(j => j.state === 'DELIVERED' || j.state === 'CLOSED').length;
    jobStats.failed = todayJobs.filter(j => j.state === 'FAILED').length;
    jobStats.deadLettered = todayJobs.filter(j => j.state === 'DEAD_LETTER').length;
  } catch (err) {
    logger.warn('[dailySummary] Could not read job stats', { error: err.message });
  }

  // Invoice stats
  let invoiceStats = { generated: 0, totalAmount: 0 };
  try {
    const invoices = await readData('invoices.json');
    const inv = (invoices && invoices.invoices) || [];
    const todayInv = inv.filter(i => i.createdAt && i.createdAt.startsWith(today));
    invoiceStats.generated = todayInv.length;
    invoiceStats.totalAmount = todayInv.reduce((sum, i) => sum + (i.total || 0), 0);
  } catch (err) { /* ok */ }

  const summary = {
    date: today,
    generatedAt: new Date().toISOString(),
    operations: opsSummary,
    jobs: jobStats,
    invoices: invoiceStats,
    systemHealth: {
      dryRunMode: process.env.DRY_RUN === 'true' || process.env.SHADOW_MODE === 'true',
      killSwitch: process.env.KILL_SWITCH === 'true',
      mockMode: process.env.MOCK_MODE === 'true'
    }
  };

  return summary;
}

module.exports = { generateDailySummary };
