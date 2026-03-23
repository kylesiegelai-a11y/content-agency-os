/**
 * Stripe Mock Provider
 * Drop-in mock for Stripe invoice + payment operations.
 * Replace with real Stripe SDK when ready:
 *   const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');

class StripeMock {
  constructor() {
    this.invoices = new Map();
    this.customers = new Map();
    this.paymentIntents = new Map();
    logger.info('[StripeMock] Initialized — all payment operations are simulated');
  }

  // ── Customers ───────────────────────────────────────────────────
  async createCustomer({ email, name, metadata = {} }) {
    const id = `cus_mock_${uuidv4().slice(0, 8)}`;
    const customer = { id, email, name, metadata, createdAt: new Date().toISOString() };
    this.customers.set(id, customer);
    logger.info('[StripeMock] Customer created', { id, email });
    return customer;
  }

  async getOrCreateCustomer({ email, name }) {
    for (const cust of this.customers.values()) {
      if (cust.email === email) return cust;
    }
    return this.createCustomer({ email, name });
  }

  // ── Invoices ────────────────────────────────────────────────────
  async createInvoice({ customerEmail, customerName, lineItems, dueDate, metadata = {} }) {
    const customer = await this.getOrCreateCustomer({ email: customerEmail, name: customerName });
    const id = `in_mock_${uuidv4().slice(0, 8)}`;

    const total = lineItems.reduce((sum, li) => sum + (li.total || li.unitPrice * li.quantity), 0);

    const invoice = {
      id,
      customer: customer.id,
      status: 'draft',
      total,
      currency: 'usd',
      lineItems,
      dueDate,
      metadata,
      hostedInvoiceUrl: `https://invoice.stripe.com/mock/${id}`,
      createdAt: new Date().toISOString()
    };

    this.invoices.set(id, invoice);
    logger.info('[StripeMock] Invoice created', { id, total, customer: customer.id });
    return invoice;
  }

  async sendInvoice(invoiceId) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    invoice.status = 'open';
    logger.info('[StripeMock] Invoice sent', { id: invoiceId });
    return invoice;
  }

  async payInvoice(invoiceId) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    const piId = `pi_mock_${uuidv4().slice(0, 8)}`;
    const paymentIntent = {
      id: piId,
      invoiceId,
      amount: invoice.total,
      status: 'succeeded',
      createdAt: new Date().toISOString()
    };
    this.paymentIntents.set(piId, paymentIntent);

    invoice.status = 'paid';
    invoice.paymentIntentId = piId;
    invoice.paidAt = new Date().toISOString();

    logger.info('[StripeMock] Invoice paid', { id: invoiceId, paymentIntentId: piId, amount: invoice.total });
    return { invoice, paymentIntent };
  }

  async voidInvoice(invoiceId) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    invoice.status = 'void';
    logger.info('[StripeMock] Invoice voided', { id: invoiceId });
    return invoice;
  }

  // ── Webhook simulation ──────────────────────────────────────────
  simulateWebhook(type, data) {
    logger.info('[StripeMock] Webhook simulated', { type, data });
    return { type, data, created: Date.now() };
  }
}

module.exports = StripeMock;
