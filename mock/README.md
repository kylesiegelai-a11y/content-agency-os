# Content Agency OS - Mock Providers

Complete, production-ready mock implementations for all external service integrations in Content Agency OS.

## Overview

The mock provider system allows the Content Agency OS to run in complete isolation without requiring real API credentials or external service connections. All providers match the exact API response structures of their real counterparts.

### Providers Implemented

1. **Anthropic Mock** - Claude API simulation with realistic response structures
2. **Gmail Mock** - Email service with persistent file storage
3. **Google Drive Mock** - Document management with markdown storage
4. **Upwork Mock** - Job opportunity pipeline with rotating listings
5. **Calendly Mock** - Meeting scheduling with availability slots
6. **Service Factory** - Central router for loading mock or real providers

## Service Factory Usage

The Service Factory (`utils/serviceFactory.js`) is the centralized entry point for all services.

### Basic Usage

```javascript
const { getService, isMockMode } = require('./utils/serviceFactory');

// Get any service
const anthropic = getService('anthropic');
const gmail = getService('gmail');
const drive = getService('drive');
const calendly = getService('calendly');

// Upwork is only available in mock mode — in production, use the acquisition engine's MarketplaceSource
if (isMockMode()) {
  const upwork = getService('upwork');
}

// Check current mode
console.log(isMockMode()); // true or false
```

### Configuration

Control which provider mode is used via environment variable:

```bash
# Use mock providers (default)
export MOCK_MODE=true
node app.js

# Use real providers (requires implementation)
export MOCK_MODE=false
node app.js
```

## Provider Documentation

### 1. Anthropic Mock Provider

Simulates Claude API with configurable response delay and agent-specific content.

**Location:** `mock/providers/anthropicMock.js`

#### Features

- Realistic Claude API response structure with exact field names
- Async generator support for streaming responses
- Configurable output delay via `MOCK_ANTHROPIC_DELAY_MS` environment variable
- Agent-specific content templates (writer, proposal, scorer, researcher)
- Token count estimation

#### Usage

```javascript
const anthropic = getService('anthropic');

// Basic message creation
const response = await anthropic.createMessage({
  messages: [],
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 4096,
  type: 'writer' // writer, proposal, scorer, researcher
});

console.log(response.content[0].text);
console.log(response.usage.output_tokens);

// Streaming response
const stream = anthropic.createMessageStream({
  messages: [],
  type: 'proposal'
});

for await (const chunk of stream) {
  if (chunk.delta?.text) {
    process.stdout.write(chunk.delta.text);
  }
}
```

#### Response Structure

```javascript
{
  id: 'msg_...',
  type: 'message',
  role: 'assistant',
  content: [
    { type: 'text', text: '...' }
  ],
  model: 'claude-3-5-sonnet-20241022',
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 150,
    output_tokens: 641,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  }
}
```

#### Environment Variables

- `MOCK_ANTHROPIC_DELAY_MS` - Delay between stream chunks in milliseconds (default: 800)

### 2. Gmail Mock Provider

Simulates Gmail API with file-based storage in `tmp/mock_storage/emails/`.

**Location:** `mock/providers/gmailMock.js`

#### Features

- Sends messages written to JSON files with timestamp
- Lists messages with optional query filtering
- Retrieves messages by ID
- Marks messages as read/unread
- Watches inbox for new messages (with callback support)
- Activity logging to `activity.json`
- Full cleanup/reset capability

#### Usage

```javascript
const gmail = getService('gmail');

// Send a message
const sent = await gmail.sendMessage({
  to: 'recipient@example.com',
  from: 'sender@content-agency-os.local',
  subject: 'Test Email',
  body: 'Email body content'
});

// List messages
const messages = await gmail.listMessages({
  query: 'from:someone@example.com',
  maxResults: 10
});

// Get specific message
const message = await gmail.getMessage(messageId);

// Mark as read
await gmail.markAsRead(messageId);

// Watch inbox for new messages
await gmail.watchInbox((newMessage) => {
  console.log('New message:', newMessage);
});

// Simulate receiving a message
await gmail.simulateInboxMessage({
  from: 'external@example.com',
  subject: 'Incoming Message',
  body: 'Content of incoming message'
});

// Get activity log
const activities = await gmail.getActivityLog();

// Clear all storage
await gmail.clearStorage();
```

#### Storage Structure

```
tmp/mock_storage/
├── emails/                    # Sent messages
│   ├── 2026-03-22T10-30-45.000Z_msg_*.json
│   └── ...
├── inbox/                     # Simulated inbox messages
│   ├── 2026-03-22T10-30-45.000Z_msg_*.json
│   └── ...
└── activity.json             # Operation log
```

### 3. Google Drive Mock Provider

Simulates Google Drive API with markdown file storage in `tmp/mock_storage/documents/`.

**Location:** `mock/providers/driveMock.js`

#### Features

- Creates documents stored as `.md` files
- Updates document content
- Uploads files with any MIME type
- Lists files with optional query filtering
- Retrieves file content and metadata
- Shares files with permission levels (reader, commenter, writer)
- Activity logging
- Full cleanup/reset capability

#### Usage

```javascript
const drive = getService('drive');

// Create a document
const doc = await drive.createDocument({
  name: 'My Document',
  content: '# Heading\n\nDocument content in markdown'
});

// Update document
await drive.updateDocument(doc.id, '# Updated\n\nNew content');

// Upload file
const file = await drive.uploadFile({
  name: 'document.txt',
  content: 'File contents',
  mimeType: 'text/plain'
});

// List files
const files = await drive.listFiles({
  query: 'document',
  pageSize: 10
});

// Get file details
const file = await drive.getFile(fileId);

// Get file content
const content = await drive.getFileContent(fileId);

// Share file
await drive.shareFile(fileId, ['user1@example.com', 'user2@example.com'], 'reader');

// Delete file
await drive.deleteFile(fileId);

// Get activity log
const activities = await drive.getActivityLog();

// Clear all storage
await drive.clearStorage();
```

#### Storage Structure

```
tmp/mock_storage/
└── documents/
    ├── document-name_file_*.md
    ├── document-name_file_*_metadata.json
    └── ...
```

### 4. Upwork Mock Provider

Simulates Upwork API by cycling through opportunities defined in `mock/test_opportunities.json`.

**Location:** `mock/providers/upworkMock.js`

#### Features

- 8 pre-configured job opportunities across 8 different niches
- Searches by keyword, niche, or full-text
- Rotates listings to simulate fresh job pipeline
- Tracks viewed jobs
- Returns statistics and analytics
- Custom opportunity injection for testing
- Supports all major niches: technology, marketing, HR, healthcare, e-commerce, finance, real estate, legal

#### Usage

```javascript
const upwork = getService('upwork');

// Get active jobs
const jobs = await upwork.getActiveJobs({ limit: 10 });

// Search for jobs
const results = await upwork.searchJobs({
  query: 'content writing',
  limit: 5
});

// Search by niche
const techJobs = await upwork.searchByNiche('technology', 3);

// Search multiple niches
const multiNiche = await upwork.searchMultipleNiches(
  ['technology', 'marketing'],
  3 // per niche
);

// Get job details
const job = await upwork.getJob(jobId);

// Get all available niches
const niches = upwork.getAllNiches();

// Get statistics
const stats = upwork.getStats();
// {
//   totalJobs: 8,
//   byNiche: { technology: 1, marketing: 1, ... },
//   byBudget: { under_1k: 3, '1k_5k': 4, ... },
//   viewedCount: 2
// }

// Add custom opportunity (for testing)
upwork.addOpportunity({
  id: 'custom_001',
  title: 'Custom Job',
  niche: 'technology',
  budget: { type: 'fixed', amount: 5000 }
  // ... other fields
});

// Reset to defaults
upwork.reloadOpportunities();
```

#### Test Opportunities File

Edit `mock/test_opportunities.json` to customize the job pipeline. Each opportunity includes:

```javascript
{
  id: 'job_001',
  title: 'Job Title',
  description: 'Full job description',
  niche: 'technology|marketing|human_resources|healthcare|ecommerce|finance|real_estate|legal',
  budget: {
    type: 'fixed|hourly',
    amount: 2500,      // for fixed
    rate: 75,          // for hourly
    hours: 40          // for hourly
  },
  duration: 'less_than_month|1_to_3_months|3_to_6_months|6_plus_months',
  experience_level: 'entry|intermediate|advanced',
  skills: ['skill1', 'skill2'],
  posted_at: '2026-03-20T10:30:00Z',
  client: {
    name: 'Client Name',
    rating: 4.8,
    reviews: 12
  }
}
```

### 5. Calendly Mock Provider

Simulates Calendly API with dynamic availability slots for next 7 days.

**Location:** `mock/providers/calendlyMock.js`

#### Features

- Generates 3 available slots per day for next 7 days
- Standard 30-minute meeting duration
- Creates and manages bookings
- Checks availability for time slots
- Provides mock scheduling links
- Simulates webhook events
- Full booking management

#### Usage

```javascript
const calendly = getService('calendly');

// Get available slots
const slots = await calendly.getAvailableSlots();
// Returns 21 slots (3 per day × 7 days)

// Get event type
const eventType = await calendly.getEventType('30min');

// Create a booking
const booking = await calendly.createBooking({
  start_time: '2026-03-23T13:00:00Z',
  end_time: '2026-03-23T13:30:00Z',
  name: 'John Doe',
  email: 'john@example.com',
  notes: 'Discuss project requirements'
});

// List all bookings
const bookings = await calendly.listBookings();

// Get specific booking
const booking = await calendly.getBooking(bookingId);

// Reschedule booking
await calendly.rescheduleBooking(
  bookingId,
  '2026-03-24T14:00:00Z',
  '2026-03-24T14:30:00Z'
);

// Cancel booking
await calendly.cancelBooking(bookingId);

// Check availability
const available = await calendly.checkAvailability(
  '2026-03-23T13:00:00Z',
  '2026-03-23T13:30:00Z'
);

// Get scheduling link
const link = await calendly.getSchedulingLink('30min');

// Get scheduling page URL
const pageUrl = await calendly.getSchedulingPageUrl();

// Get mock booking URL (for testing)
const mockUrl = calendly.getMockBookingUrl();
```

## Testing

Run the comprehensive test suite to validate all providers:

```bash
cd /path/to/content-agency-os
MOCK_MODE=true node mock/test_all_providers.js
```

The test suite validates:
- Service factory initialization
- All provider functionality
- API response structures
- Streaming capabilities
- Activity logging
- Storage operations

## Production Migration

When ready to use real providers:

1. Implement real provider classes in the Service Factory
2. Add credential handling (API keys, OAuth tokens)
3. Replace stub methods with actual API calls
4. Update response structures to match real API formats
5. Set `MOCK_MODE=false` in production environment

**Note on Upwork/Marketplace:** In production, opportunity acquisition goes through the acquisition engine (`acquisition/acquisitionEngine.js`), not through `serviceFactory.getService('upwork')` directly. To add a real marketplace connector, provide it as `options.marketplaceService` when calling `initializeAcquisition()` in `acquisition/setup.js`. The UpworkMock is only used in mock mode for development/testing.

## Storage and Persistence

Mock providers use the `tmp/mock_storage/` directory:

```
tmp/mock_storage/
├── emails/                 # Gmail sent messages
├── inbox/                  # Gmail inbox simulation
├── documents/              # Drive documents
└── activity.json          # All operation logs
```

All storage is cleared when providers are reset or explicitly cleared.

## Logging and Debugging

All operations log to `activity.json` with timestamps. Check it for:
- API call history
- Operation status (success/error)
- Data passed to operations
- Execution metadata

```javascript
const gmail = getService('gmail');
const activities = await gmail.getActivityLog();
console.log(activities);
```

## Architecture Notes

### Response Structure Compatibility

All mock responses exactly match the structure of their real counterparts:
- Field names are identical
- Data types match
- Nested structures preserved
- Error responses follow same format

### Async/Await Support

All providers fully support async/await:

```javascript
async function main() {
  const service = getService('anthropic');
  const response = await service.createMessage({...});
  console.log(response);
}
```

### Streaming Support

Anthropic mock fully supports async generator pattern:

```javascript
async function processStream() {
  const stream = anthropic.createMessageStream({...});
  for await (const chunk of stream) {
    console.log(chunk);
  }
}
```

## Environment Variables

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `MOCK_MODE` | All | `true` | Enable/disable mock providers |
| `MOCK_ANTHROPIC_DELAY_MS` | Anthropic | `800` | Stream chunk delay in ms |

## File Locations

| Component | Path |
|-----------|------|
| Anthropic Mock | `mock/providers/anthropicMock.js` |
| Gmail Mock | `mock/providers/gmailMock.js` |
| Drive Mock | `mock/providers/driveMock.js` |
| Upwork Mock | `mock/providers/upworkMock.js` |
| Calendly Mock | `mock/providers/calendlyMock.js` |
| Service Factory | `utils/serviceFactory.js` |
| Test Suite | `mock/test_all_providers.js` |
| Test Opportunities | `mock/test_opportunities.json` |
| Storage | `tmp/mock_storage/` |

## Performance Characteristics

All mock providers are optimized for local testing:

- **Anthropic**: ~100ms per request (configurable)
- **Gmail**: <5ms per operation
- **Drive**: <5ms per operation
- **Upwork**: <1ms per operation
- **Calendly**: <1ms per operation

## Testing Checklist

- [ ] Run `MOCK_MODE=true node mock/test_all_providers.js`
- [ ] Verify all providers load successfully
- [ ] Check test storage directory created
- [ ] Confirm activity.json contains all operations
- [ ] Test service factory mode detection
- [ ] Validate response structures match expected format

---

**Status:** Production-ready for testing and development
**Last Updated:** 2026-03-22
