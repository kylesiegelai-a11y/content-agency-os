# Mock Providers Quick Start

## 5-Minute Setup

### 1. Enable Mock Mode

```bash
export MOCK_MODE=true
```

### 2. Import Service Factory

```javascript
const { getService } = require('./utils/serviceFactory');
```

### 3. Get Any Service

```javascript
const anthropic = getService('anthropic');
const gmail = getService('gmail');
const drive = getService('drive');
const upwork = getService('upwork');
const calendly = getService('calendly');
```

## Common Usage Patterns

### Generate Content with Anthropic

```javascript
const anthropic = getService('anthropic');

// Generate article
const article = await anthropic.createMessage({
  type: 'writer',
  messages: []
});

// Generate proposal
const proposal = await anthropic.createMessage({
  type: 'proposal',
  messages: []
});

// Generate scores
const scores = await anthropic.createMessage({
  type: 'scorer',
  messages: []
});
```

### Send Emails

```javascript
const gmail = getService('gmail');

await gmail.sendMessage({
  to: 'client@example.com',
  subject: 'Project Update',
  body: 'Here is your update...'
});
```

### Store Documents

```javascript
const drive = getService('drive');

const doc = await drive.createDocument({
  name: 'Project Proposal',
  content: '# My Proposal\n\nContent here...'
});

// Share it
await drive.shareFile(doc.id, ['user@example.com'], 'reader');
```

### Browse Job Opportunities

```javascript
const upwork = getService('upwork');

// Get active jobs
const jobs = await upwork.getActiveJobs({ limit: 5 });

// Search by niche
const techJobs = await upwork.searchByNiche('technology', 3);

// Get details
const job = await upwork.getJob(jobId);
```

### Schedule Meetings

```javascript
const calendly = getService('calendly');

// Get available slots
const slots = await calendly.getAvailableSlots();

// Create booking
const booking = await calendly.createBooking({
  start_time: slots.collection[0].start_time,
  end_time: slots.collection[0].end_time,
  name: 'Client Name',
  email: 'client@example.com'
});
```

## Testing

```bash
# Run full test suite
cd content-agency-os
MOCK_MODE=true node mock/test_all_providers.js
```

## Streaming Responses

```javascript
const anthropic = getService('anthropic');

const stream = anthropic.createMessageStream({
  type: 'writer'
});

for await (const chunk of stream) {
  if (chunk.delta?.text) {
    process.stdout.write(chunk.delta.text);
  }
}
```

## Check Storage

View what was created:

```bash
ls -la tmp/mock_storage/emails/
ls -la tmp/mock_storage/documents/
cat tmp/mock_storage/activity.json
```

## Configuration

| Setting | How |
|---------|-----|
| Use real providers | `export MOCK_MODE=false` |
| Slower streaming | `export MOCK_ANTHROPIC_DELAY_MS=2000` |
| View activity log | `cat tmp/mock_storage/activity.json` |

## All Services Reference

| Service | Method | Example |
|---------|--------|---------|
| **anthropic** | `createMessage({type, messages})` | Writer, proposal, scorer |
| **gmail** | `sendMessage({to, subject, body})` | Send emails |
| **gmail** | `listMessages({query})` | Search emails |
| **drive** | `createDocument({name, content})` | Create docs |
| **drive** | `shareFile(id, emails, role)` | Share docs |
| **upwork** | `searchByNiche(niche, limit)` | Find jobs |
| **upwork** | `getJob(id)` | Job details |
| **calendly** | `getAvailableSlots()` | List times |
| **calendly** | `createBooking({...})` | Schedule meeting |

## Niches for Upwork

```
technology, marketing, human_resources, healthcare,
ecommerce, finance, real_estate, legal
```

## Example: Complete Workflow

```javascript
const { getService } = require('./utils/serviceFactory');

async function workflow() {
  // 1. Find a job
  const upwork = getService('upwork');
  const jobs = await upwork.searchByNiche('technology', 1);
  const job = jobs.data[0];
  console.log(`Found: ${job.title}`);

  // 2. Generate proposal
  const anthropic = getService('anthropic');
  const proposal = await anthropic.createMessage({
    type: 'proposal',
    messages: []
  });
  console.log(`Generated proposal (${proposal.usage.output_tokens} tokens)`);

  // 3. Save to Drive
  const drive = getService('drive');
  const doc = await drive.createDocument({
    name: `Proposal for ${job.title}`,
    content: proposal.content[0].text
  });
  console.log(`Saved to: ${doc.webViewLink}`);

  // 4. Send email
  const gmail = getService('gmail');
  await gmail.sendMessage({
    to: job.client.name,
    subject: `Proposal: ${job.title}`,
    body: `Here is my proposal for your project.`
  });
  console.log('Email sent!');

  // 5. Schedule meeting
  const calendly = getService('calendly');
  const slots = await calendly.getAvailableSlots();
  const booking = await calendly.createBooking({
    start_time: slots.collection[0].start_time,
    end_time: slots.collection[0].end_time,
    name: 'Project Kickoff',
    email: job.client.email
  });
  console.log(`Meeting scheduled: ${booking.resource.location.join_url}`);
}

workflow().catch(console.error);
```

## Files

| File | Purpose |
|------|---------|
| `mock/providers/anthropicMock.js` | Claude API simulation |
| `mock/providers/gmailMock.js` | Email service |
| `mock/providers/driveMock.js` | Document storage |
| `mock/providers/upworkMock.js` | Job opportunities |
| `mock/providers/calendlyMock.js` | Meeting scheduling |
| `utils/serviceFactory.js` | Service router |
| `mock/test_all_providers.js` | Test suite |
| `mock/test_opportunities.json` | Job data |

## Troubleshooting

**Services not loading?**
```bash
export MOCK_MODE=true  # Make sure this is set
```

**Storage permission error?**
```bash
mkdir -p tmp/mock_storage/{emails,documents,inbox}
chmod 755 tmp/mock_storage
```

**Slow streaming?**
```bash
export MOCK_ANTHROPIC_DELAY_MS=100  # Reduce from default 800
```

**Need to reset?**
```bash
rm -rf tmp/mock_storage
```

---

**More Info:** See `mock/README.md` for full documentation
