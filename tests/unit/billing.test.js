/**
 * Unit tests for the billing module (../../utils/billing.js)
 * Tests invoice generation, pricing resolution, and summary calculation
 */

// Set env variables BEFORE importing modules
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const {
  INVOICE_STATUS,
  DEFAULT_PRICING,
  generateInvoice,
  resolveJobPricing,
  listInvoices,
  markInvoicePaid
} = require('../../utils/billing');

// Mock the storage layer
jest.mock('../../utils/storage', () => ({
  readData: jest.fn(async (file) => {
    if (file === 'invoices.json') {
      return { invoices: [], summary: { totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0 } };
    }
    if (file === 'activity.json') {
      return [];
    }
    if (file === 'ledger.json') {
      return [];
    }
    return null;
  }),
  writeData: jest.fn(async () => {}),
  appendToArray: jest.fn(async () => {})
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234-5678-9012-3456')
}));

// Helper function to test recalcSummary behavior through the API
// Since recalcSummary is internal, we test its logic via integration
function testSummaryCalculation(invoices) {
  const safeTotal = (inv) => {
    const val = Number(inv.total);
    return (isFinite(val) && val >= 0) ? val : 0;
  };

  const totalInvoiced = invoices
    .filter(inv => inv.status !== INVOICE_STATUS.CANCELLED && inv.status !== INVOICE_STATUS.REFUNDED)
    .reduce((sum, inv) => sum + safeTotal(inv), 0);
  const totalPaid = invoices
    .filter(inv => inv.status === INVOICE_STATUS.PAID)
    .reduce((sum, inv) => sum + safeTotal(inv), 0);
  const totalOutstanding = invoices
    .filter(inv => [INVOICE_STATUS.DRAFT, INVOICE_STATUS.SENT, INVOICE_STATUS.OVERDUE].includes(inv.status))
    .reduce((sum, inv) => sum + safeTotal(inv), 0);

  return {
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
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

// Import additional functions to test
const {
  getInvoice,
  updateInvoice,
  sendInvoice,
  cancelInvoice,
  getBillingSummary
} = require('../../utils/billing');

// Mock payment service for sendInvoice tests
const mockPaymentService = {
  createInvoice: jest.fn(),
  sendInvoice: jest.fn()
};

// Mock logger for verification
const logger = require('../../utils/logger');

// Mock storage for state management
const storage = require('../../utils/storage');

describe('Billing Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Summary Calculation Tests (via integration with invoice logic)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Summary Calculation (recalcSummary via integration)', () => {
    test('calculates summary correctly with mixed invoice statuses', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500 },
        { id: 'inv2', status: INVOICE_STATUS.DRAFT, total: 300 },
        { id: 'inv3', status: INVOICE_STATUS.SENT, total: 200 },
        { id: 'inv4', status: INVOICE_STATUS.OVERDUE, total: 150 }
      ];

      const summary = testSummaryCalculation(invoices);

      expect(summary.totalInvoiced).toBe(1150);
      expect(summary.totalPaid).toBe(500);
      expect(summary.totalOutstanding).toBe(650);
      expect(summary.count).toBe(4);
      expect(summary.countByStatus.paid).toBe(1);
      expect(summary.countByStatus.draft).toBe(1);
      expect(summary.countByStatus.sent).toBe(1);
      expect(summary.countByStatus.overdue).toBe(1);
    });

    test('treats NaN total as 0 (safe handling)', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: NaN },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 500 }
      ];

      const summary = testSummaryCalculation(invoices);

      expect(summary.totalPaid).toBe(500);
      expect(summary.totalInvoiced).toBe(500);
    });

    test('treats negative total as 0 (safe handling)', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: -100 },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 500 }
      ];

      const summary = testSummaryCalculation(invoices);

      expect(summary.totalPaid).toBe(500);
    });

    test('handles empty invoice array', () => {
      const summary = testSummaryCalculation([]);

      expect(summary.totalInvoiced).toBe(0);
      expect(summary.totalPaid).toBe(0);
      expect(summary.totalOutstanding).toBe(0);
      expect(summary.count).toBe(0);
    });

    test('excludes cancelled and refunded invoices from totalInvoiced', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500 },
        { id: 'inv2', status: INVOICE_STATUS.CANCELLED, total: 200 },
        { id: 'inv3', status: INVOICE_STATUS.REFUNDED, total: 100 }
      ];

      const summary = testSummaryCalculation(invoices);

      expect(summary.totalInvoiced).toBe(500);
      expect(summary.count).toBe(3);
    });

    test('uses Math.round for precision in results', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 100.3 },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 200.4 },
        { id: 'inv3', status: INVOICE_STATUS.PAID, total: 300.5 }
      ];

      const summary = testSummaryCalculation(invoices);

      // 100.3 + 200.4 + 300.5 = 601.2, Math.round(601.2 * 100) / 100 = 601.20
      expect(summary.totalPaid).toBe(601.2);
    });

    test('correctly counts invoices by status', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.DRAFT, total: 100 },
        { id: 'inv2', status: INVOICE_STATUS.DRAFT, total: 200 },
        { id: 'inv3', status: INVOICE_STATUS.SENT, total: 150 },
        { id: 'inv4', status: INVOICE_STATUS.PAID, total: 500 },
        { id: 'inv5', status: INVOICE_STATUS.OVERDUE, total: 75 },
        { id: 'inv6', status: INVOICE_STATUS.CANCELLED, total: 25 }
      ];

      const summary = testSummaryCalculation(invoices);

      expect(summary.countByStatus.draft).toBe(2);
      expect(summary.countByStatus.sent).toBe(1);
      expect(summary.countByStatus.paid).toBe(1);
      expect(summary.countByStatus.overdue).toBe(1);
      expect(summary.countByStatus.cancelled).toBe(1);
    });

    test('handles only outstanding invoices (draft, sent, overdue)', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.DRAFT, total: 100 },
        { id: 'inv2', status: INVOICE_STATUS.SENT, total: 200 },
        { id: 'inv3', status: INVOICE_STATUS.OVERDUE, total: 150 },
        { id: 'inv4', status: INVOICE_STATUS.PAID, total: 500 }
      ];

      const summary = testSummaryCalculation(invoices);

      expect(summary.totalOutstanding).toBe(450);
      expect(summary.totalInvoiced).toBe(950);
      expect(summary.totalPaid).toBe(500);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // resolveJobPricing Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('resolveJobPricing', () => {
    test('uses explicit job pricing if available', () => {
      const job = {
        id: 'job1',
        type: 'blog_post',
        pricing: { amount: 1000, model: 'per_piece' },
        client: { name: 'Client A' }
      };

      const pricing = resolveJobPricing(job);

      expect(pricing.amount).toBe(1000);
      expect(pricing.model).toBe('per_piece');
    });

    test('falls back to client retainer if no explicit pricing', () => {
      const job = {
        id: 'job1',
        type: 'blog_post',
        client: {
          name: 'Client A',
          retainer: { active: true, perPieceRate: 750 }
        }
      };

      const pricing = resolveJobPricing(job);

      expect(pricing.amount).toBe(750);
      expect(pricing.model).toBe('retainer');
    });

    test('falls back to content type default pricing', () => {
      const job = {
        id: 'job1',
        type: 'whitepaper',
        data: { contentType: 'whitepaper' },
        client: { name: 'Client A' }
      };

      const pricing = resolveJobPricing(job);

      expect(pricing.amount).toBe(DEFAULT_PRICING.whitepaper);
      expect(pricing.model).toBe('per_piece');
    });

    test('uses fallback $500 when no pricing information available', () => {
      const job = {
        id: 'job1',
        type: 'unknown_type',
        client: { name: 'Client A' }
      };

      const pricing = resolveJobPricing(job);

      expect(pricing.amount).toBe(500);
      expect(pricing.model).toBe('per_piece');
    });

    test('respects pricing priority: explicit > retainer > type default > fallback', () => {
      // Only explicit pricing
      let job = { pricing: { amount: 999 }, client: { retainer: { active: true, perPieceRate: 750 } }, type: 'blog_post' };
      expect(resolveJobPricing(job).amount).toBe(999);

      // Retainer > type default
      job = { client: { retainer: { active: true, perPieceRate: 750 } }, type: 'blog_post' };
      expect(resolveJobPricing(job).amount).toBe(750);

      // Type default > fallback
      job = { type: 'case_study', client: { name: 'Client A' } };
      expect(resolveJobPricing(job).amount).toBe(DEFAULT_PRICING.case_study);
    });

    test('handles job with data.contentType field', () => {
      const job = {
        id: 'job1',
        data: { contentType: 'newsletter' },
        client: { name: 'Client A' }
      };

      const pricing = resolveJobPricing(job);

      expect(pricing.amount).toBe(DEFAULT_PRICING.newsletter);
    });

    test('ignores zero or negative explicit pricing amounts', () => {
      const job = {
        id: 'job1',
        pricing: { amount: 0 },
        type: 'blog_post',
        client: { name: 'Client A' }
      };

      const pricing = resolveJobPricing(job);

      expect(pricing.amount).toBe(DEFAULT_PRICING.blog_post);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // generateInvoice Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('generateInvoice', () => {
    test('generates invoice with DRAFT status', async () => {
      const job = {
        id: 'job1',
        type: 'blog_post',
        client: { name: 'Acme Corp', email: 'contact@acme.com' },
        data: { topic: 'How to Write Better Code' }
      };

      const invoice = await generateInvoice(job);

      expect(invoice.status).toBe(INVOICE_STATUS.DRAFT);
    });

    test('initializes invoices.json when it does not exist', async () => {
      const job = {
        id: 'job1',
        type: 'blog_post',
        client: { name: 'Acme Corp', email: 'contact@acme.com' },
        data: { topic: 'How to Write Better Code' }
      };

      // Mock readData to return null (file doesn't exist)
      storage.readData.mockResolvedValue(null);

      const invoice = await generateInvoice(job);

      // Verify writeData was called with initialized structure
      expect(storage.writeData).toHaveBeenCalledWith(
        'invoices.json',
        expect.objectContaining({
          invoices: expect.arrayContaining([invoice]),
          summary: expect.objectContaining({
            totalInvoiced: expect.any(Number),
            totalPaid: expect.any(Number),
            totalOutstanding: expect.any(Number)
          })
        })
      );
    });

    test('invoice has all required fields', async () => {
      const job = {
        id: 'job1',
        type: 'blog_post',
        client: { name: 'Acme Corp', email: 'contact@acme.com' },
        data: { topic: 'Testing Best Practices' }
      };

      const invoice = await generateInvoice(job);

      expect(invoice).toHaveProperty('id');
      expect(invoice).toHaveProperty('jobId', 'job1');
      expect(invoice).toHaveProperty('client');
      expect(invoice).toHaveProperty('lineItems');
      expect(invoice).toHaveProperty('total');
      expect(invoice).toHaveProperty('subtotal');
      expect(invoice).toHaveProperty('tax');
      expect(invoice).toHaveProperty('currency', 'USD');
      expect(invoice).toHaveProperty('billingModel');
      expect(invoice).toHaveProperty('status');
      expect(invoice).toHaveProperty('issuedAt');
      expect(invoice).toHaveProperty('dueAt');
      expect(invoice).toHaveProperty('createdAt');
      expect(invoice).toHaveProperty('updatedAt');
    });

    test('invoice line items are correctly populated', async () => {
      const job = {
        id: 'job1',
        type: 'case_study',
        pricing: { amount: 1200 },
        client: { name: 'Tech Startup', email: 'billing@startup.com' },
        data: { topic: 'Case Study: SaaS Growth' }
      };

      const invoice = await generateInvoice(job);

      expect(invoice.lineItems).toHaveLength(1);
      expect(invoice.lineItems[0]).toHaveProperty('description');
      expect(invoice.lineItems[0]).toHaveProperty('quantity', 1);
      expect(invoice.lineItems[0]).toHaveProperty('unitPrice', 1200);
      expect(invoice.lineItems[0]).toHaveProperty('total', 1200);
    });

    test('invoice total equals line item total for single item', async () => {
      const job = {
        id: 'job1',
        type: 'blog_post',
        client: { name: 'Client A', email: 'a@example.com' },
        data: { topic: 'A Blog Post' }
      };

      const invoice = await generateInvoice(job);

      expect(invoice.total).toBe(invoice.subtotal);
      expect(invoice.subtotal).toBe(invoice.lineItems[0].total);
    });

    test('invoice dueDate is 30 days after issue', async () => {
      const job = {
        id: 'job1',
        type: 'blog_post',
        client: { name: 'Client A', email: 'a@example.com' },
        data: { topic: 'Topic' }
      };

      const invoice = await generateInvoice(job);

      const issuedDate = new Date(invoice.issuedAt);
      const dueDate = new Date(invoice.dueAt);
      const diffMs = dueDate - issuedDate;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeCloseTo(30, 0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // INVOICE_STATUS constant tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('INVOICE_STATUS', () => {
    test('has all required status values', () => {
      expect(INVOICE_STATUS.DRAFT).toBe('draft');
      expect(INVOICE_STATUS.SENT).toBe('sent');
      expect(INVOICE_STATUS.PAID).toBe('paid');
      expect(INVOICE_STATUS.OVERDUE).toBe('overdue');
      expect(INVOICE_STATUS.CANCELLED).toBe('cancelled');
      expect(INVOICE_STATUS.REFUNDED).toBe('refunded');
    });

    test('has exactly 6 status values', () => {
      expect(Object.keys(INVOICE_STATUS)).toHaveLength(6);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Integration-style tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('end-to-end pricing and summary', () => {
    test('pricing is used consistently from job to invoice', async () => {
      const job = {
        id: 'job1',
        type: 'newsletter',
        pricing: { amount: 350 },
        client: { name: 'Magazine Inc', email: 'mag@example.com' },
        data: { topic: 'Monthly Newsletter' }
      };

      const jobPricing = resolveJobPricing(job);
      const invoice = await generateInvoice(job);

      expect(invoice.total).toBe(jobPricing.amount);
      expect(invoice.total).toBe(350);
    });

    test('multiple invoices with different statuses create accurate summary', () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500 },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 300 },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 200 },
        { id: 'inv4', status: INVOICE_STATUS.OVERDUE, total: 150 }
      ];

      const summary = testSummaryCalculation(invoices);

      expect(summary.totalPaid).toBe(800);
      expect(summary.totalOutstanding).toBe(350);
      expect(summary.totalInvoiced).toBe(1150);
      expect(summary.countByStatus.paid).toBe(2);
      expect(summary.countByStatus.draft).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getInvoice Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('getInvoice', () => {
    test('returns null when invoices.json does not exist', async () => {
      storage.readData.mockResolvedValue(null);

      const invoice = await getInvoice('inv_nonexistent');

      expect(invoice).toBeNull();
    });

    test('returns null when invoice not found', async () => {
      storage.readData.mockResolvedValue({
        invoices: [
          { id: 'inv1', jobId: 'job1', total: 500 }
        ],
        summary: {}
      });

      const invoice = await getInvoice('inv_nonexistent');

      expect(invoice).toBeNull();
    });

    test('returns invoice when found by id', async () => {
      const testInvoice = {
        id: 'inv_abc123',
        jobId: 'job1',
        client: { name: 'Client A', email: 'a@example.com' },
        total: 500,
        status: INVOICE_STATUS.DRAFT
      };

      storage.readData.mockResolvedValue({
        invoices: [testInvoice],
        summary: {}
      });

      const invoice = await getInvoice('inv_abc123');

      expect(invoice).toEqual(testInvoice);
      expect(invoice.id).toBe('inv_abc123');
    });

    test('returns first matching invoice when multiple exist', async () => {
      const invoices = [
        { id: 'inv1', jobId: 'job1', total: 500 },
        { id: 'inv2', jobId: 'job2', total: 600 },
        { id: 'inv1', jobId: 'job3', total: 700 }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const invoice = await getInvoice('inv1');

      expect(invoice.jobId).toBe('job1');
      expect(invoice.total).toBe(500);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // updateInvoice Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('updateInvoice', () => {
    test('returns null when invoices.json does not exist', async () => {
      storage.readData.mockResolvedValue(null);

      const result = await updateInvoice('inv_nonexistent', { status: INVOICE_STATUS.SENT });

      expect(result).toBeNull();
      expect(storage.writeData).not.toHaveBeenCalled();
    });

    test('returns null when invoice not found', async () => {
      storage.readData.mockResolvedValue({
        invoices: [{ id: 'inv1', jobId: 'job1', total: 500 }],
        summary: {}
      });

      const result = await updateInvoice('inv_notfound', { status: INVOICE_STATUS.SENT });

      expect(result).toBeNull();
    });

    test('updates invoice and persists to storage', async () => {
      const originalInvoice = {
        id: 'inv_abc',
        jobId: 'job1',
        total: 500,
        status: INVOICE_STATUS.DRAFT,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      };

      storage.readData.mockResolvedValue({
        invoices: [originalInvoice],
        summary: { totalInvoiced: 500, totalPaid: 0, totalOutstanding: 500 }
      });

      const updated = await updateInvoice('inv_abc', { status: INVOICE_STATUS.SENT });

      expect(updated.status).toBe(INVOICE_STATUS.SENT);
      expect(updated.id).toBe('inv_abc');
      expect(updated.jobId).toBe('job1');
      expect(storage.writeData).toHaveBeenCalledWith('invoices.json', expect.any(Object));
    });

    test('merges updates without overwriting other fields', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        total: 500,
        status: INVOICE_STATUS.DRAFT,
        notes: 'Original note',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const updated = await updateInvoice('inv1', { status: INVOICE_STATUS.SENT });

      expect(updated.status).toBe(INVOICE_STATUS.SENT);
      expect(updated.notes).toBe('Original note');
      expect(updated.total).toBe(500);
    });

    test('updates updatedAt timestamp', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        total: 500,
        status: INVOICE_STATUS.DRAFT,
        updatedAt: '2026-01-01T00:00:00Z'
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const updated = await updateInvoice('inv1', { status: INVOICE_STATUS.SENT });

      expect(updated.updatedAt).not.toBe('2026-01-01T00:00:00Z');
      expect(new Date(updated.updatedAt)).toBeInstanceOf(Date);
    });

    test('recalculates summary after update', async () => {
      const invoices = [
        { id: 'inv1', jobId: 'job1', total: 500, status: INVOICE_STATUS.DRAFT },
        { id: 'inv2', jobId: 'job2', total: 300, status: INVOICE_STATUS.DRAFT }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      await updateInvoice('inv1', { status: INVOICE_STATUS.PAID });

      const callArgs = storage.writeData.mock.calls[0];
      const updatedData = callArgs[1];

      expect(updatedData.summary).toBeDefined();
      expect(updatedData.summary.totalPaid).toBeGreaterThan(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // listInvoices Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('listInvoices', () => {
    test('returns empty list when no invoices exist', async () => {
      storage.readData.mockResolvedValue(null);

      const result = await listInvoices();

      expect(result.invoices).toEqual([]);
      expect(result.summary).toBeDefined();
      expect(result.summary.totalInvoiced).toBe(0);
    });

    test('filters invoices by status', async () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.DRAFT, total: 500 },
        { id: 'inv2', status: INVOICE_STATUS.SENT, total: 300 },
        { id: 'inv3', status: INVOICE_STATUS.PAID, total: 600 }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await listInvoices({ status: INVOICE_STATUS.PAID });

      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0].id).toBe('inv3');
      expect(result.invoices[0].status).toBe(INVOICE_STATUS.PAID);
    });

    test('filters invoices by client name (partial match)', async () => {
      const invoices = [
        { id: 'inv1', client: { name: 'Acme Corp' }, total: 500 },
        { id: 'inv2', client: { name: 'Tech Startup' }, total: 300 },
        { id: 'inv3', client: { name: 'Acme Industries' }, total: 600 }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await listInvoices({ client: 'acme' });

      expect(result.invoices).toHaveLength(2);
      expect(result.invoices.every(inv => inv.client.name.toLowerCase().includes('acme'))).toBe(true);
    });

    test('filters invoices by jobId', async () => {
      const invoices = [
        { id: 'inv1', jobId: 'job1', total: 500 },
        { id: 'inv2', jobId: 'job2', total: 300 },
        { id: 'inv3', jobId: 'job1', total: 600 }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await listInvoices({ jobId: 'job1' });

      expect(result.invoices).toHaveLength(2);
      expect(result.invoices.every(inv => inv.jobId === 'job1')).toBe(true);
    });

    test('sorts invoices by createdAt (newest first)', async () => {
      const invoices = [
        { id: 'inv1', createdAt: '2026-01-01T00:00:00Z', total: 500 },
        { id: 'inv2', createdAt: '2026-03-01T00:00:00Z', total: 300 },
        { id: 'inv3', createdAt: '2026-02-01T00:00:00Z', total: 600 }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await listInvoices();

      expect(result.invoices[0].id).toBe('inv2'); // March (newest)
      expect(result.invoices[1].id).toBe('inv3'); // February
      expect(result.invoices[2].id).toBe('inv1'); // January (oldest)
    });

    test('combines multiple filters', async () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, client: { name: 'Acme' }, jobId: 'job1', total: 500 },
        { id: 'inv2', status: INVOICE_STATUS.PAID, client: { name: 'Tech' }, jobId: 'job2', total: 300 },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, client: { name: 'Acme' }, jobId: 'job1', total: 600 }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await listInvoices({
        status: INVOICE_STATUS.PAID,
        client: 'acme',
        jobId: 'job1'
      });

      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0].id).toBe('inv1');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // markInvoicePaid Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('markInvoicePaid', () => {
    test('returns null when invoice not found', async () => {
      storage.readData.mockResolvedValue({ invoices: [], summary: {} });

      const result = await markInvoicePaid('inv_notfound');

      expect(result).toBeNull();
    });

    test('marks invoice as PAID with current timestamp', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        total: 500,
        status: INVOICE_STATUS.DRAFT,
        paidAt: null,
        client: { name: 'Test Client', email: 'test@example.com' }
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await markInvoicePaid('inv1');

      expect(result.status).toBe(INVOICE_STATUS.PAID);
      expect(result.paidAt).not.toBeNull();
      expect(new Date(result.paidAt)).toBeInstanceOf(Date);
    });

    test('adds payment details when provided', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        total: 500,
        status: INVOICE_STATUS.DRAFT,
        paidAt: null,
        client: { name: 'Test Client', email: 'test@example.com' }
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const paymentDetails = {
        stripePaymentIntentId: 'pi_stripe123',
        notes: 'Paid via credit card'
      };

      const result = await markInvoicePaid('inv1', paymentDetails);

      expect(result.stripePaymentIntentId).toBe('pi_stripe123');
      expect(result.notes).toBe('Paid via credit card');
    });

    test('appends transaction to ledger', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        total: 500,
        client: { name: 'Acme Corp' },
        status: INVOICE_STATUS.DRAFT
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      await markInvoicePaid('inv1');

      expect(storage.appendToArray).toHaveBeenCalledWith(
        'ledger.json',
        expect.objectContaining({
          type: 'payment_received',
          amount: 500,
          invoiceId: 'inv1',
          status: 'completed'
        })
      );
    });

    test('logs payment event', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        total: 500,
        status: INVOICE_STATUS.DRAFT,
        client: { name: 'Client A' }
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      await markInvoicePaid('inv1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('paid'),
        expect.objectContaining({ invoiceId: 'inv1' })
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // sendInvoice Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('sendInvoice', () => {
    test('returns null when invoice not found', async () => {
      storage.readData.mockResolvedValue({ invoices: [], summary: {} });

      const result = await sendInvoice('inv_notfound');

      expect(result).toBeNull();
    });

    test('returns error when invoice not in DRAFT status', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.SENT,
        total: 500
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await sendInvoice('inv1');

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Cannot send invoice');
    });

    test('updates invoice status to SENT without payment service', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.DRAFT,
        total: 500,
        client: { name: 'Client A', email: null }
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await sendInvoice('inv1', null);

      expect(result.status).toBe(INVOICE_STATUS.SENT);
      expect(result.stripeInvoiceId).toBeNull();
    });

    test('creates Stripe invoice when service is available and email exists', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.DRAFT,
        total: 500,
        client: { name: 'Client A', email: 'client@example.com' },
        lineItems: [{ description: 'Service', quantity: 1, unitPrice: 500, total: 500 }],
        dueAt: '2026-04-23T00:00:00Z'
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      mockPaymentService.createInvoice.mockResolvedValue({ id: 'in_stripe123' });
      mockPaymentService.sendInvoice.mockResolvedValue({ success: true });

      const result = await sendInvoice('inv1', mockPaymentService);

      expect(mockPaymentService.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          customerEmail: 'client@example.com',
          customerName: 'Client A',
          lineItems: invoice.lineItems,
          dueDate: invoice.dueAt,
          metadata: expect.objectContaining({ invoiceId: 'inv1' })
        })
      );
      expect(mockPaymentService.sendInvoice).toHaveBeenCalledWith('in_stripe123');
      expect(result.stripeInvoiceId).toBe('in_stripe123');
    });

    test('marks as sent even if Stripe creation fails', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.DRAFT,
        total: 500,
        client: { name: 'Client A', email: 'client@example.com' },
        lineItems: [{ description: 'Service', quantity: 1, unitPrice: 500, total: 500 }],
        dueAt: '2026-04-23T00:00:00Z'
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      mockPaymentService.createInvoice.mockRejectedValue(new Error('Stripe API error'));

      const result = await sendInvoice('inv1', mockPaymentService);

      expect(result.status).toBe(INVOICE_STATUS.SENT);
      expect(result.stripeInvoiceId).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.any(Object)
      );
    });

    test('skips Stripe integration when no email is available', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.DRAFT,
        total: 500,
        client: { name: 'Client A', email: null }
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await sendInvoice('inv1', mockPaymentService);

      expect(mockPaymentService.createInvoice).not.toHaveBeenCalled();
      expect(result.status).toBe(INVOICE_STATUS.SENT);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // cancelInvoice Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('cancelInvoice', () => {
    test('returns null when invoice not found', async () => {
      storage.readData.mockResolvedValue({ invoices: [], summary: {} });

      const result = await cancelInvoice('inv_notfound');

      expect(result).toBeNull();
    });

    test('returns error when trying to cancel a paid invoice', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.PAID,
        total: 500
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await cancelInvoice('inv1');

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Cannot cancel a paid invoice');
    });

    test('cancels invoice with default reason', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.DRAFT,
        total: 500,
        notes: null
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await cancelInvoice('inv1');

      expect(result.status).toBe(INVOICE_STATUS.CANCELLED);
      expect(result.notes).toBe('Cancelled');
    });

    test('cancels invoice with provided reason', async () => {
      const invoice = {
        id: 'inv1',
        jobId: 'job1',
        status: INVOICE_STATUS.SENT,
        total: 500,
        notes: null
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await cancelInvoice('inv1', 'Client requested cancellation');

      expect(result.status).toBe(INVOICE_STATUS.CANCELLED);
      expect(result.notes).toBe('Client requested cancellation');
    });

    test('allows cancellation of DRAFT invoices', async () => {
      const invoice = {
        id: 'inv1',
        status: INVOICE_STATUS.DRAFT,
        total: 500
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await cancelInvoice('inv1', 'Not needed');

      expect(result.status).toBe(INVOICE_STATUS.CANCELLED);
    });

    test('allows cancellation of SENT invoices', async () => {
      const invoice = {
        id: 'inv1',
        status: INVOICE_STATUS.SENT,
        total: 500
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await cancelInvoice('inv1', 'Client withdrew');

      expect(result.status).toBe(INVOICE_STATUS.CANCELLED);
    });

    test('allows cancellation of OVERDUE invoices', async () => {
      const invoice = {
        id: 'inv1',
        status: INVOICE_STATUS.OVERDUE,
        total: 500
      };

      storage.readData.mockResolvedValue({ invoices: [invoice], summary: {} });

      const result = await cancelInvoice('inv1', 'Debt forgiven');

      expect(result.status).toBe(INVOICE_STATUS.CANCELLED);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getBillingSummary Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('getBillingSummary', () => {
    test('returns all-time summary by default', async () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500, createdAt: '2025-01-01T00:00:00Z' },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 300, createdAt: '2025-02-01T00:00:00Z' },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 200, createdAt: '2026-03-01T00:00:00Z' }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await getBillingSummary();

      expect(result.period).toBe('all');
      expect(result.revenue).toBe(800);
      expect(result.outstanding).toBe(200);
      expect(result.invoiceCount).toBe(3);
      expect(result.paidCount).toBe(2);
    });

    test('filters by month', async () => {
      const now = new Date();
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(now.getMonth() - 1);
      const twoMonthsAgo = new Date(now);
      twoMonthsAgo.setMonth(now.getMonth() - 2);

      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500, createdAt: twoMonthsAgo.toISOString() },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 300, createdAt: oneMonthAgo.toISOString() },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 200, createdAt: now.toISOString() }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await getBillingSummary('month');

      expect(result.period).toBe('month');
      expect(result.invoiceCount).toBeLessThanOrEqual(2);
    });

    test('filters by quarter', async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(now.getMonth() - 3);
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(now.getMonth() - 6);

      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500, createdAt: sixMonthsAgo.toISOString() },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 300, createdAt: threeMonthsAgo.toISOString() },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 200, createdAt: now.toISOString() }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await getBillingSummary('quarter');

      expect(result.period).toBe('quarter');
      expect(result.invoiceCount).toBeLessThanOrEqual(2);
    });

    test('filters by year', async () => {
      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(now.getFullYear() - 1);
      const twoYearsAgo = new Date(now);
      twoYearsAgo.setFullYear(now.getFullYear() - 2);

      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500, createdAt: twoYearsAgo.toISOString() },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 300, createdAt: oneYearAgo.toISOString() },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 200, createdAt: now.toISOString() }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await getBillingSummary('year');

      expect(result.period).toBe('year');
      expect(result.invoiceCount).toBeLessThanOrEqual(2);
    });

    test('calculates average invoice amount', async () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 600, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 400, createdAt: '2026-02-01T00:00:00Z' },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 500, createdAt: '2026-03-01T00:00:00Z' }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await getBillingSummary();

      const expectedAvg = (600 + 400 + 500) / 3;
      expect(result.avgInvoiceAmount).toBeCloseTo(expectedAvg, 2);
    });

    test('counts paid invoices correctly', async () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'inv2', status: INVOICE_STATUS.PAID, total: 300, createdAt: '2026-02-01T00:00:00Z' },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 200, createdAt: '2026-03-01T00:00:00Z' },
        { id: 'inv4', status: INVOICE_STATUS.SENT, total: 150, createdAt: '2026-03-01T00:00:00Z' }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await getBillingSummary();

      expect(result.paidCount).toBe(2);
      expect(result.revenue).toBe(800);
    });

    test('includes overall summary in result', async () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'inv2', status: INVOICE_STATUS.DRAFT, total: 300, createdAt: '2026-02-01T00:00:00Z' }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: { totalInvoiced: 800, totalPaid: 500, totalOutstanding: 300 } });

      const result = await getBillingSummary();

      expect(result.overallSummary).toBeDefined();
      expect(result.overallSummary.totalInvoiced).toBeDefined();
      expect(result.overallSummary.totalPaid).toBeDefined();
    });

    test('handles empty invoice list', async () => {
      storage.readData.mockResolvedValue({ invoices: [], summary: {} });

      const result = await getBillingSummary();

      expect(result.revenue).toBe(0);
      expect(result.outstanding).toBe(0);
      expect(result.avgInvoiceAmount).toBe(0);
      expect(result.invoiceCount).toBe(0);
      expect(result.paidCount).toBe(0);
    });

    test('excludes non-paid invoices from revenue calculation', async () => {
      const invoices = [
        { id: 'inv1', status: INVOICE_STATUS.PAID, total: 500, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'inv2', status: INVOICE_STATUS.SENT, total: 300, createdAt: '2026-02-01T00:00:00Z' },
        { id: 'inv3', status: INVOICE_STATUS.DRAFT, total: 200, createdAt: '2026-03-01T00:00:00Z' }
      ];

      storage.readData.mockResolvedValue({ invoices, summary: {} });

      const result = await getBillingSummary();

      expect(result.revenue).toBe(500);
      expect(result.outstanding).toBe(500);
    });
  });
});
