/**
 * Billing Service
 * Handles invoice generation, tracking, and payment processor integration.
 *
 * Supports two billing models:
 *   - Per-piece: fixed price per content deliverable
 *   - Retainer: monthly recurring fee with content volume included
 *
 * Auto-generates invoices when jobs reach DELIVERED state.
 * Stripe integration is scaffolded — swap StripeMock for real Stripe SDK.
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const { readData, writeData, appendToArray } = require('./storage');

// ── Invoice statuses ────────────────────────────────────────────────
const INVOICE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
};

// ── Default pricing (overridden by client retainer or job-level pricing) ──
const DEFAULT_PRICING = {
  blog_post: 500,
  social_set: 200,
  whitepaper: 1500,
  case_study: 800,
  newsletter: 300,
  email_sequence: 600,
  content: 500  // generic fallback
};

// ── Invoice generation ──────────────────────────────────────────────

/**
 * Generate an invoice for a delivered job.
 * Called automatically when a job reaches DELIVERED state.
 */
async function generateInvoice(job) {
  const invoiceId = `inv_${uuidv4().slice(0, 8)}`;
  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 30); // Net 30

  // Determine pricing
  const pricing = resolveJobPricing(job);

  const invoice = {
    id: invoiceId,
    jobId: job.id,
    client: {
      name: job.data?.client || job.client?.name || 'Unknown Client',
      email: job.client?.email || job.data?.clientEmail || null
    },
    lineItems: [{
      description: buildLineItemDescription(job),
      quantity: 1,
      unitPrice: pricing.amount,
      total: pricing.amount
    }],
    subtotal: pricing.amount,
    tax: 0,
    total: pricing.amount,
    currency: 'USD',
    billingModel: pricing.model, // 'per_piece' or 'retainer'
    status: INVOICE_STATUS.DRAFT,
    issuedAt: now.toISOString(),
    dueAt: dueDate.toISOString(),
    paidAt: null,
    stripeInvoiceId: null,
    stripePaymentIntentId: null,
    notes: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  // Persist
  await saveInvoice(invoice);

  // Log to ledger
  await appendToArray('ledger.json', {
    id: `txn_${uuidv4().slice(0, 8)}`,
    type: 'revenue',
    category: 'content_delivery',
    amount: pricing.amount,
    invoiceId,
    jobId: job.id,
    client: invoice.client.name,
    description: `Invoice ${invoiceId} generated for ${buildLineItemDescription(job)}`,
    status: 'pending',
    timestamp: now.toISOString()
  });

  // Log activity
  await appendToArray('activity.json', {
    timestamp: now.toISOString(),
    agent: 'billing',
    jobId: job.id,
    action: 'invoice_generated',
    invoiceId,
    amount: pricing.amount,
    client: invoice.client.name,
    status: 'completed'
  });

  logger.info('Invoice generated', {
    invoiceId,
    jobId: job.id,
    amount: pricing.amount,
    model: pricing.model,
    event: 'invoice_generated'
  });

  return invoice;
}

/**
 * Resolve pricing for a job.
 * Checks: job.pricing → client retainer → content type default → fallback.
 */
function resolveJobPricing(job) {
  // Explicit pricing on the job
  if (job.pricing?.amount && job.pricing.amount > 0) {
    return {
      amount: job.pricing.amount,
      model: job.pricing.model || 'per_piece'
    };
  }

  // Retainer pricing from client data
  if (job.client?.retainer?.active) {
    return {
      amount: job.client.retainer.perPieceRate || 0,
      model: 'retainer'
    };
  }

  // Default by content type
  const contentType = job.data?.contentType || job.type || 'content';
  const amount = DEFAULT_PRICING[contentType] || DEFAULT_PRICING.content;

  return { amount, model: 'per_piece' };
}

/**
 * Build a human-readable line item description.
 */
function buildLineItemDescription(job) {
  const topic = job.data?.topic || job.topic || job.title || 'Content piece';
  const client = job.data?.client || job.client?.name || '';
  const type = job.data?.contentType || job.type || 'content';
  return `${type.charAt(0).toUpperCase() + type.slice(1)}: "${topic}"${client ? ` for ${client}` : ''}`;
}

// ── Invoice persistence ─────────────────────────────────────────────

async function saveInvoice(invoice) {
  let data = await readData('invoices.json');
  if (!data || !Array.isArray(data.invoices)) {
    data = { invoices: [], summary: { totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0 } };
  }
  data.invoices.push(invoice);
  data.summary = recalcSummary(data.invoices);
  await writeData('invoices.json', data);
  return invoice;
}

async function updateInvoice(invoiceId, updates) {
  let data = await readData('invoices.json');
  if (!data || !Array.isArray(data.invoices)) return null;

  const idx = data.invoices.findIndex(inv => inv.id === invoiceId);
  if (idx === -1) return null;

  data.invoices[idx] = { ...data.invoices[idx], ...updates, updatedAt: new Date().toISOString() };
  data.summary = recalcSummary(data.invoices);
  await writeData('invoices.json', data);
  return data.invoices[idx];
}

async function getInvoice(invoiceId) {
  const data = await readData('invoices.json');
  if (!data || !Array.isArray(data.invoices)) return null;
  return data.invoices.find(inv => inv.id === invoiceId) || null;
}

async function listInvoices(filters = {}) {
  const data = await readData('invoices.json');
  if (!data || !Array.isArray(data.invoices)) return { invoices: [], summary: defaultSummary() };

  let invoices = [...data.invoices];

  if (filters.status) {
    invoices = invoices.filter(inv => inv.status === filters.status);
  }
  if (filters.client) {
    const q = filters.client.toLowerCase();
    invoices = invoices.filter(inv => inv.client.name.toLowerCase().includes(q));
  }
  if (filters.jobId) {
    invoices = invoices.filter(inv => inv.jobId === filters.jobId);
  }

  // Sort newest first
  invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { invoices, summary: data.summary || recalcSummary(data.invoices) };
}

function recalcSummary(invoices) {
  const totalInvoiced = invoices
    .filter(inv => inv.status !== INVOICE_STATUS.CANCELLED && inv.status !== INVOICE_STATUS.REFUNDED)
    .reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = invoices
    .filter(inv => inv.status === INVOICE_STATUS.PAID)
    .reduce((sum, inv) => sum + inv.total, 0);
  const totalOutstanding = invoices
    .filter(inv => [INVOICE_STATUS.DRAFT, INVOICE_STATUS.SENT, INVOICE_STATUS.OVERDUE].includes(inv.status))
    .reduce((sum, inv) => sum + inv.total, 0);

  return {
    totalInvoiced: parseFloat(totalInvoiced.toFixed(2)),
    totalPaid: parseFloat(totalPaid.toFixed(2)),
    totalOutstanding: parseFloat(totalOutstanding.toFixed(2)),
    count: invoices.length,
    countByStatus: {
      draft: invoices.filter(inv => inv.status === INVOICE_STATUS.DRAFT).length,
      sent: invoices.filter(inv => inv.status === INVOICE_STATUS.SENT).length,
      paid: invoices.filter(inv => inv.status === INVOICE_STATUS.PAID).length,
      overdue: invoices.filter(inv => inv.status === INVOICE_STATUS.OVERDUE).length,
      cancelled: invoices.filter(inv => inv.status === INVOICE_STATUS.CANCELLED).length
    }
  };
}

function defaultSummary() {
  return { totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0, count: 0, countByStatus: {} };
}

// ── Payment operations ──────────────────────────────────────────────

/**
 * Mark an invoice as paid (manual or via Stripe webhook).
 */
async function markInvoicePaid(invoiceId, paymentDetails = {}) {
  const now = new Date().toISOString();

  const updated = await updateInvoice(invoiceId, {
    status: INVOICE_STATUS.PAID,
    paidAt: now,
    stripePaymentIntentId: paymentDetails.stripePaymentIntentId || null,
    notes: paymentDetails.notes || null
  });

  if (!updated) return null;

  // Update ledger entry
  await appendToArray('ledger.json', {
    id: `txn_${uuidv4().slice(0, 8)}`,
    type: 'payment_received',
    category: 'client_payment',
    amount: updated.total,
    invoiceId,
    jobId: updated.jobId,
    client: updated.client.name,
    description: `Payment received for invoice ${invoiceId}`,
    status: 'completed',
    timestamp: now
  });

  logger.info('Invoice marked as paid', { invoiceId, amount: updated.total, event: 'invoice_paid' });

  return updated;
}

/**
 * Send an invoice (update status, optionally trigger Stripe invoice).
 */
async function sendInvoice(invoiceId, paymentService = null) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return null;
  if (invoice.status !== INVOICE_STATUS.DRAFT) {
    return { error: `Cannot send invoice in ${invoice.status} status` };
  }

  let stripeInvoiceId = null;

  // If payment service is available, create Stripe invoice
  if (paymentService && invoice.client.email) {
    try {
      const stripeResult = await paymentService.createInvoice({
        customerEmail: invoice.client.email,
        customerName: invoice.client.name,
        lineItems: invoice.lineItems,
        dueDate: invoice.dueAt,
        metadata: { invoiceId: invoice.id, jobId: invoice.jobId }
      });
      stripeInvoiceId = stripeResult.id;

      await paymentService.sendInvoice(stripeResult.id);

      logger.info('Stripe invoice created and sent', {
        invoiceId, stripeInvoiceId, event: 'stripe_invoice_sent'
      });
    } catch (err) {
      logger.warn('Stripe invoice creation failed, marking as sent anyway', {
        invoiceId, error: err.message, event: 'stripe_invoice_error'
      });
    }
  }

  return updateInvoice(invoiceId, {
    status: INVOICE_STATUS.SENT,
    stripeInvoiceId
  });
}

/**
 * Cancel an invoice.
 */
async function cancelInvoice(invoiceId, reason = '') {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return null;
  if (invoice.status === INVOICE_STATUS.PAID) {
    return { error: 'Cannot cancel a paid invoice — use refund instead' };
  }

  return updateInvoice(invoiceId, {
    status: INVOICE_STATUS.CANCELLED,
    notes: reason || 'Cancelled'
  });
}

// ── Billing summary / reporting ─────────────────────────────────────

async function getBillingSummary(period = 'all') {
  const { invoices, summary } = await listInvoices();

  let filtered = invoices;
  if (period !== 'all') {
    const now = new Date();
    const cutoff = new Date();
    if (period === 'month') cutoff.setMonth(now.getMonth() - 1);
    else if (period === 'quarter') cutoff.setMonth(now.getMonth() - 3);
    else if (period === 'year') cutoff.setFullYear(now.getFullYear() - 1);
    filtered = invoices.filter(inv => new Date(inv.createdAt) >= cutoff);
  }

  const revenue = filtered
    .filter(inv => inv.status === INVOICE_STATUS.PAID)
    .reduce((sum, inv) => sum + inv.total, 0);
  const outstanding = filtered
    .filter(inv => [INVOICE_STATUS.DRAFT, INVOICE_STATUS.SENT, INVOICE_STATUS.OVERDUE].includes(inv.status))
    .reduce((sum, inv) => sum + inv.total, 0);
  const avgInvoice = filtered.length > 0
    ? filtered.reduce((sum, inv) => sum + inv.total, 0) / filtered.length
    : 0;

  return {
    period,
    revenue: parseFloat(revenue.toFixed(2)),
    outstanding: parseFloat(outstanding.toFixed(2)),
    avgInvoiceAmount: parseFloat(avgInvoice.toFixed(2)),
    invoiceCount: filtered.length,
    paidCount: filtered.filter(inv => inv.status === INVOICE_STATUS.PAID).length,
    overallSummary: summary
  };
}

module.exports = {
  INVOICE_STATUS,
  DEFAULT_PRICING,
  generateInvoice,
  resolveJobPricing,
  getInvoice,
  listInvoices,
  updateInvoice,
  markInvoicePaid,
  sendInvoice,
  cancelInvoice,
  getBillingSummary
};
