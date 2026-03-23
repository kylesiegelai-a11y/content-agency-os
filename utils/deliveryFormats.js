/**
 * Delivery Format Engine
 * Generates deliverables in multiple formats: Markdown, PDF, branded HTML, Google Docs.
 * Supports KAIL branding (default) and white-label per client config.
 *
 * Usage:
 *   const { generateDeliverables } = require('./utils/deliveryFormats');
 *   const results = await generateDeliverables(job, content, options);
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { marked } = require('marked');
const logger = require('./logger');

// ── Constants ────────────────────────────────────────────────────────
const DELIVERABLES_DIR = path.join(process.cwd(), 'data', 'deliverables');

const SUPPORTED_FORMATS = ['markdown', 'pdf', 'html', 'google_docs'];

// ── Branding defaults ────────────────────────────────────────────────
const KAIL_BRAND = {
  companyName: 'KAIL Data Services',
  tagline: 'AI-Powered Content Solutions',
  primaryColor: '#1a73e8',
  secondaryColor: '#1a1f26',
  accentColor: '#34a853',
  textColor: '#e8eaed',
  logoText: 'KAIL',  // Text fallback when no logo file
  website: 'https://kaildataservices.com',
  footerText: 'Produced by KAIL Data Services — AI-Powered Content Solutions'
};

// ── Helpers ──────────────────────────────────────────────────────────

function ensureDeliverableDir() {
  if (!fs.existsSync(DELIVERABLES_DIR)) {
    fs.mkdirSync(DELIVERABLES_DIR, { recursive: true });
  }
}

/**
 * Build a safe filename prefix from job + content metadata.
 */
function buildFilePrefix(jobId, content, job) {
  const safeTitle = (content.title || job.topic || job.title || 'Untitled')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80)
    || 'Untitled';
  return `${jobId}_${safeTitle}`;
}

/**
 * Resolve branding: use client brand if whiteLabel is set, otherwise KAIL.
 */
function resolveBranding(job) {
  const client = job.client || {};
  if (client.whiteLabel && client.brand) {
    return {
      ...KAIL_BRAND,
      ...client.brand,
      isWhiteLabel: true
    };
  }
  return { ...KAIL_BRAND, isWhiteLabel: false };
}

/**
 * Convert markdown body to plain text (strip markdown syntax).
 */
function markdownToPlainText(md) {
  return (md || '')
    .replace(/#{1,6}\s+/g, '')       // headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1')     // italic
    .replace(/`(.+?)`/g, '$1')       // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/!\[.*?\]\(.+?\)/g, '')    // images
    .replace(/^[-*+]\s+/gm, '• ')      // bullet lists
    .replace(/^\d+\.\s+/gm, '')        // numbered lists
    .replace(/---+/g, '')              // horizontal rules
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Format generators ────────────────────────────────────────────────

/**
 * Generate Markdown deliverable.
 */
function generateMarkdown(filePrefix, content, brand) {
  ensureDeliverableDir();
  const filename = `${filePrefix}.md`;
  const filepath = path.join(DELIVERABLES_DIR, filename);
  const now = new Date().toISOString();

  const header = brand.isWhiteLabel
    ? `> ${brand.companyName}\n\n`
    : `> ${brand.companyName} — ${brand.tagline}\n\n`;

  const body = [
    header,
    `# ${content.title || 'Untitled'}\n\n`,
    content.body || '',
    '\n\n---\n',
    `*Delivered: ${new Date(now).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}*\n`,
    `*${brand.footerText || brand.companyName}*\n`
  ].join('');

  fs.writeFileSync(filepath, body);
  logger.info('[deliveryFormats] Markdown generated', { filename });

  return {
    format: 'markdown',
    filename,
    path: filepath,
    size: body.length,
    url: `file://${filepath}`
  };
}

/**
 * Generate branded HTML deliverable.
 */
function generateHTML(filePrefix, content, brand) {
  ensureDeliverableDir();
  const filename = `${filePrefix}.html`;
  const filepath = path.join(DELIVERABLES_DIR, filename);

  // Convert markdown body → HTML
  const bodyHTML = marked(content.body || '', { breaks: true });
  const deliveredDate = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.title || 'Untitled'} — ${brand.companyName}</title>
  <style>
    :root {
      --primary: ${brand.primaryColor};
      --secondary: ${brand.secondaryColor};
      --accent: ${brand.accentColor};
      --text: ${brand.textColor || '#333'};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
      line-height: 1.7;
      color: #333;
      background: #fafafa;
    }
    .header {
      background: var(--secondary);
      color: #fff;
      padding: 2rem 3rem;
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }
    .header .logo {
      font-size: 1.8rem;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: 2px;
    }
    .header .company-name {
      font-size: 1rem;
      opacity: 0.8;
    }
    .content {
      max-width: 800px;
      margin: 3rem auto;
      padding: 0 2rem;
    }
    .content h1 {
      font-size: 2.2rem;
      margin-bottom: 1.5rem;
      color: var(--secondary);
      border-bottom: 3px solid var(--primary);
      padding-bottom: 0.5rem;
    }
    .content h2 { font-size: 1.5rem; margin-top: 2rem; margin-bottom: 0.75rem; color: #222; }
    .content h3 { font-size: 1.25rem; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #444; }
    .content p { margin-bottom: 1rem; }
    .content ul, .content ol { margin: 1rem 0; padding-left: 2rem; }
    .content li { margin-bottom: 0.5rem; }
    .content blockquote {
      border-left: 4px solid var(--primary);
      padding: 0.75rem 1.25rem;
      margin: 1.5rem 0;
      background: #f0f4ff;
      color: #555;
    }
    .content code {
      background: #f0f0f0;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .content pre {
      background: #1e2228;
      color: #e8eaed;
      padding: 1.25rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1.5rem 0;
    }
    .content pre code { background: none; color: inherit; padding: 0; }
    .content img { max-width: 100%; border-radius: 6px; margin: 1rem 0; }
    .footer {
      max-width: 800px;
      margin: 3rem auto;
      padding: 2rem;
      border-top: 1px solid #ddd;
      text-align: center;
      color: #888;
      font-size: 0.85rem;
    }
    .footer a { color: var(--primary); text-decoration: none; }
    @media print {
      .header { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      body { background: #fff; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">${brand.logoText || brand.companyName}</div>
    <div class="company-name">${brand.tagline || ''}</div>
  </div>
  <div class="content">
    <h1>${content.title || 'Untitled'}</h1>
    ${bodyHTML}
  </div>
  <div class="footer">
    <p>Delivered ${deliveredDate}</p>
    <p>${brand.footerText || brand.companyName}</p>
    ${brand.website ? `<p><a href="${brand.website}">${brand.website}</a></p>` : ''}
  </div>
</body>
</html>`;

  fs.writeFileSync(filepath, html);
  logger.info('[deliveryFormats] HTML generated', { filename });

  return {
    format: 'html',
    filename,
    path: filepath,
    size: html.length,
    url: `file://${filepath}`
  };
}

/**
 * Generate branded PDF deliverable using PDFKit.
 */
function generatePDF(filePrefix, content, brand) {
  ensureDeliverableDir();
  const filename = `${filePrefix}.pdf`;
  const filepath = path.join(DELIVERABLES_DIR, filename);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: content.title || 'Untitled',
          Author: brand.companyName,
          Creator: 'Content Agency OS'
        }
      });

      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // ── Header bar ──────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 60)
         .fill(brand.secondaryColor || '#1a1f26');

      doc.fontSize(20)
         .fillColor(brand.primaryColor || '#1a73e8')
         .text(brand.logoText || brand.companyName, 72, 18, { width: 200 });

      if (brand.tagline) {
        doc.fontSize(9)
           .fillColor('#9aa0a6')
           .text(brand.tagline, 200, 24, { width: 300, align: 'right' });
      }

      // ── Title ───────────────────────────────────────────
      doc.moveDown(2);
      doc.fontSize(24)
         .fillColor('#1a1f26')
         .text(content.title || 'Untitled', 72, 90, { width: doc.page.width - 144 });

      // Divider line under title
      const titleBottom = doc.y + 8;
      doc.moveTo(72, titleBottom)
         .lineTo(doc.page.width - 72, titleBottom)
         .strokeColor(brand.primaryColor || '#1a73e8')
         .lineWidth(2)
         .stroke();

      // ── Body text ───────────────────────────────────────
      const plainBody = markdownToPlainText(content.body || '');
      const paragraphs = plainBody.split(/\n\n+/);

      doc.moveDown(1);
      doc.y = titleBottom + 20;

      for (const para of paragraphs) {
        if (!para.trim()) continue;

        // Detect heading-like lines (ALL CAPS or short single lines)
        const trimmed = para.trim();

        if (trimmed.startsWith('• ')) {
          // Bullet item
          doc.fontSize(11)
             .fillColor('#333')
             .text(trimmed, 90, doc.y, { width: doc.page.width - 162, lineGap: 4 });
          doc.moveDown(0.3);
        } else if (trimmed.length < 80 && trimmed === trimmed.replace(/[a-z]/g, '').trim()) {
          // ALL-CAPS short line → subheading
          doc.moveDown(0.5);
          doc.fontSize(14)
             .fillColor('#1a1f26')
             .text(trimmed, 72, doc.y, { width: doc.page.width - 144 });
          doc.moveDown(0.3);
        } else {
          // Regular paragraph
          doc.fontSize(11)
             .fillColor('#333')
             .text(trimmed, 72, doc.y, { width: doc.page.width - 144, lineGap: 4, align: 'justify' });
          doc.moveDown(0.6);
        }
      }

      // ── Footer ──────────────────────────────────────────
      const deliveredDate = new Date().toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });

      // Add footer on every page
      const addFooter = () => {
        const bottom = doc.page.height - 50;
        doc.moveTo(72, bottom)
           .lineTo(doc.page.width - 72, bottom)
           .strokeColor('#ddd')
           .lineWidth(0.5)
           .stroke();

        doc.fontSize(8)
           .fillColor('#999')
           .text(
             `${brand.footerText || brand.companyName}  •  Delivered ${deliveredDate}`,
             72, bottom + 8,
             { width: doc.page.width - 144, align: 'center' }
           );
      };

      // Apply footer to all pages
      const pageRange = doc.bufferedPageRange();
      for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
        doc.switchToPage(i);
        addFooter();
      }

      doc.end();

      stream.on('finish', () => {
        const stats = fs.statSync(filepath);
        logger.info('[deliveryFormats] PDF generated', { filename, size: stats.size });
        resolve({
          format: 'pdf',
          filename,
          path: filepath,
          size: stats.size,
          url: `file://${filepath}`
        });
      });

      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Google Docs deliverable via Drive service.
 * Falls back gracefully in mock mode.
 */
async function generateGoogleDoc(filePrefix, content, brand, job) {
  try {
    const serviceFactory = require('./serviceFactory');
    const driveService = serviceFactory.getService('drive');

    const title = `${(content.title || 'Untitled')} — ${brand.companyName} — ${new Date().toLocaleDateString()}`;

    const docBody = [
      brand.isWhiteLabel ? '' : `[${brand.companyName}]\n\n`,
      content.body || '',
      `\n\n---\nDelivered by ${brand.companyName}`
    ].join('');

    const result = await driveService.createDocument({
      title,
      content: docBody,
      mimeType: 'application/vnd.google-apps.document'
    });

    // Share with client if configured
    if (job.shareWithClient && job.client?.email) {
      try {
        await driveService.shareDocument({
          fileId: result.id,
          email: job.client.email,
          role: 'viewer'
        });
        logger.info('[deliveryFormats] Google Doc shared with client', { email: job.client.email });
      } catch (shareErr) {
        logger.warn('[deliveryFormats] Could not share Google Doc', { error: shareErr.message });
      }
    }

    logger.info('[deliveryFormats] Google Doc created', { docId: result.id });

    return {
      format: 'google_docs',
      documentId: result.id,
      title: result.title,
      url: result.webViewLink || `https://docs.google.com/document/d/${result.id}`,
      shared: !!job.shareWithClient
    };
  } catch (err) {
    logger.warn('[deliveryFormats] Google Docs creation failed', { error: err.message });
    return {
      format: 'google_docs',
      status: 'failed',
      error: err.message
    };
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Generate deliverables in all requested formats.
 *
 * @param {Object} job - Full job object
 * @param {Object} content - { title, body } content to deliver
 * @param {Object} [options] - Override options
 * @param {string[]} [options.formats] - Override format list
 * @param {Object} [options.brand] - Override branding
 * @returns {Promise<Object[]>} Array of delivery result objects
 */
async function generateDeliverables(job, content, options = {}) {
  const formats = options.formats
    || job.deliveryFormats
    || job.client?.deliveryFormats
    || ['markdown'];

  const brand = options.brand || resolveBranding(job);
  const filePrefix = buildFilePrefix(job.jobId || job.id || `delivery_${Date.now()}`, content, job);

  const results = [];

  for (const fmt of formats) {
    try {
      switch (fmt) {
        case 'markdown':
          results.push(generateMarkdown(filePrefix, content, brand));
          break;
        case 'pdf':
          results.push(await generatePDF(filePrefix, content, brand));
          break;
        case 'html':
          results.push(generateHTML(filePrefix, content, brand));
          break;
        case 'google_docs':
          results.push(await generateGoogleDoc(filePrefix, content, brand, job));
          break;
        default:
          logger.warn('[deliveryFormats] Unknown format requested', { format: fmt });
          results.push({ format: fmt, status: 'unsupported', error: `Format "${fmt}" is not supported` });
      }
    } catch (err) {
      logger.error(`[deliveryFormats] ${fmt} generation failed`, { error: err.message });
      results.push({ format: fmt, status: 'failed', error: err.message });
    }
  }

  return results;
}

module.exports = {
  generateDeliverables,
  generateMarkdown,
  generateHTML,
  generatePDF,
  generateGoogleDoc,
  resolveBranding,
  SUPPORTED_FORMATS,
  KAIL_BRAND,
  DELIVERABLES_DIR
};
