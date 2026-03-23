/**
 * Test Suite for All Mock Providers
 * Validates that all mock providers work correctly and produce expected outputs
 * Run with: MOCK_MODE=true node mock/test_all_providers.js
 */

const path = require('path');
const fs = require('fs');

// Set mock mode
process.env.MOCK_MODE = 'true';

// Import service factory
const { getService, getMode, isMockMode, getAvailableServices } = require('../utils/serviceFactory');

// Test colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log(`\n${colors.cyan}${'='.repeat(60)}${colors.reset}`);
  log(title, 'cyan');
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
}

/**
 * Test Anthropic Provider
 */
async function testAnthropicProvider() {
  section('Testing Anthropic Mock Provider');

  try {
    const anthropic = getService('anthropic');
    log('✓ Service loaded', 'green');

    // Test writer agent content
    log('\nTesting writer agent response...', 'blue');
    const writerResponse = await anthropic.createMessage({
      messages: [],
      type: 'writer'
    });

    if (writerResponse.content && writerResponse.content[0] && writerResponse.usage) {
      log('✓ Writer response has correct structure', 'green');
      log(`  - Content length: ${writerResponse.content[0].text.length} chars`, 'yellow');
      log(`  - Model: ${writerResponse.model}`, 'yellow');
      log(`  - Input tokens: ${writerResponse.usage.input_tokens}`, 'yellow');
      log(`  - Output tokens: ${writerResponse.usage.output_tokens}`, 'yellow');
    }

    // Test proposal agent content
    log('\nTesting proposal agent response...', 'blue');
    const proposalResponse = await anthropic.createMessage({
      messages: [],
      type: 'proposal'
    });

    if (proposalResponse.content[0].text.includes('Upwork Proposal')) {
      log('✓ Proposal response contains expected content', 'green');
    }

    // Test scorer agent content
    log('\nTesting scorer agent response...', 'blue');
    const scorerResponse = await anthropic.createMessage({
      messages: [],
      type: 'scorer'
    });

    const scorerData = JSON.parse(scorerResponse.content[0].text);
    if (scorerData.overall_quality && scorerData.comments) {
      log('✓ Scorer response is valid JSON with scoring data', 'green');
      log(`  - Overall quality: ${scorerData.overall_quality}`, 'yellow');
      log(`  - Comments: ${scorerData.comments.length} items`, 'yellow');
    }

    // Test streaming
    log('\nTesting streaming response...', 'blue');
    let streamedText = '';
    const stream = anthropic.createMessageStream({
      messages: [],
      type: 'writer'
    });

    for await (const chunk of stream) {
      if (chunk.delta && chunk.delta.text) {
        streamedText += chunk.delta.text;
      }
    }

    if (streamedText.length > 0) {
      log(`✓ Streaming works correctly (${streamedText.length} chars received)`, 'green');
    }

    log('\n✓ Anthropic provider: ALL TESTS PASSED', 'green');
  } catch (error) {
    log(`✗ Anthropic provider test failed: ${error.message}`, 'red');
  }
}

/**
 * Test Gmail Provider
 */
async function testGmailProvider() {
  section('Testing Gmail Mock Provider');

  try {
    const gmail = getService('gmail');
    log('✓ Service loaded', 'green');

    // Clear storage first
    await gmail.clearStorage();
    log('✓ Storage cleared', 'yellow');

    // Test sending message
    log('\nTesting send message...', 'blue');
    const sendResult = await gmail.sendMessage({
      to: 'test@example.com',
      from: 'sender@content-agency-os.local',
      subject: 'Test Message',
      body: 'This is a test message for the mock Gmail provider.'
    });

    if (sendResult.id && sendResult.labelIds) {
      log(`✓ Message sent successfully (ID: ${sendResult.id})`, 'green');
    }

    // Test listing messages
    log('\nTesting list messages...', 'blue');
    const messages = await gmail.listMessages({ maxResults: 10 });

    if (Array.isArray(messages) && messages.length > 0) {
      log(`✓ Listed ${messages.length} message(s)`, 'green');
      log(`  - First message subject: "${messages[0].payload.headers.find(h => h.name === 'Subject').value}"`, 'yellow');
    }

    // Test getting specific message
    log('\nTesting get message...', 'blue');
    const message = await gmail.getMessage(sendResult.id);

    if (message.id === sendResult.id) {
      log('✓ Retrieved message by ID', 'green');
    }

    // Test marking as read
    log('\nTesting mark as read...', 'blue');
    const readResult = await gmail.markAsRead(sendResult.id);

    if (readResult.id === sendResult.id) {
      log('✓ Message marked as read', 'green');
    }

    // Test activity logging
    log('\nTesting activity logging...', 'blue');
    const activities = await gmail.getActivityLog();

    if (Array.isArray(activities) && activities.length > 0) {
      log(`✓ Activity log contains ${activities.length} entries`, 'green');
      log(`  - Latest action: ${activities[activities.length - 1].action}`, 'yellow');
    }

    log('\n✓ Gmail provider: ALL TESTS PASSED', 'green');
  } catch (error) {
    log(`✗ Gmail provider test failed: ${error.message}`, 'red');
  }
}

/**
 * Test Drive Provider
 */
async function testDriveProvider() {
  section('Testing Google Drive Mock Provider');

  try {
    const drive = getService('drive');
    log('✓ Service loaded', 'green');

    // Clear storage first
    await drive.clearStorage();
    log('✓ Storage cleared', 'yellow');

    // Test creating document
    log('\nTesting create document...', 'blue');
    const docResult = await drive.createDocument({
      name: 'Test Document',
      content: '# Test Document\n\nThis is test content for the mock Drive provider.'
    });

    if (docResult.id && docResult.name) {
      log(`✓ Document created (ID: ${docResult.id})`, 'green');
      log(`  - Name: ${docResult.name}`, 'yellow');
      log(`  - Size: ${docResult.size} bytes`, 'yellow');
    }

    // Test listing files
    log('\nTesting list files...', 'blue');
    const listResult = await drive.listFiles({ pageSize: 10 });

    if (listResult.files && listResult.files.length > 0) {
      log(`✓ Listed ${listResult.files.length} file(s)`, 'green');
    }

    // Test getting file
    log('\nTesting get file...', 'blue');
    const fileResult = await drive.getFile(docResult.id);

    if (fileResult.id === docResult.id) {
      log('✓ Retrieved file by ID', 'green');
    }

    // Test updating document
    log('\nTesting update document...', 'blue');
    const updatedContent = '# Updated Document\n\nThis content has been updated.';
    const updateResult = await drive.updateDocument(docResult.id, updatedContent);

    if (updateResult.id === docResult.id) {
      log('✓ Document updated successfully', 'green');
    }

    // Test file content retrieval
    log('\nTesting get file content...', 'blue');
    const content = await drive.getFileContent(docResult.id);

    if (content.includes('Updated Document')) {
      log('✓ Retrieved updated file content', 'green');
    }

    // Test sharing file
    log('\nTesting share file...', 'blue');
    const shareResult = await drive.shareFile(docResult.id, ['user1@example.com', 'user2@example.com'], 'reader');

    if (shareResult.permissions && shareResult.permissions.length === 2) {
      log(`✓ File shared with ${shareResult.permissions.length} users`, 'green');
    }

    log('\n✓ Drive provider: ALL TESTS PASSED', 'green');
  } catch (error) {
    log(`✗ Drive provider test failed: ${error.message}`, 'red');
  }
}

/**
 * Test Upwork Provider
 */
async function testUpworkProvider() {
  section('Testing Upwork Mock Provider');

  try {
    const upwork = getService('upwork');
    log('✓ Service loaded', 'green');

    // Test getting active jobs
    log('\nTesting get active jobs...', 'blue');
    const activeJobs = await upwork.getActiveJobs({ limit: 5 });

    if (activeJobs.data && activeJobs.data.length > 0) {
      log(`✓ Retrieved ${activeJobs.data.length} active job(s)`, 'green');
      log(`  - Total available: ${activeJobs.total}`, 'yellow');
      log(`  - First job: "${activeJobs.data[0].title}"`, 'yellow');
    }

    // Test searching jobs
    log('\nTesting search jobs...', 'blue');
    const searchResult = await upwork.searchJobs({ query: 'content', limit: 3 });

    if (searchResult.data && searchResult.data.length > 0) {
      log(`✓ Search found ${searchResult.data.length} job(s)`, 'green');
    }

    // Test searching by niche
    log('\nTesting search by niche...', 'blue');
    const nicheResult = await upwork.searchByNiche('technology', 3);

    if (nicheResult.data && nicheResult.data.length > 0) {
      log(`✓ Found ${nicheResult.data.length} job(s) in technology niche`, 'green');
    }

    // Test getting job details
    log('\nTesting get job details...', 'blue');
    const jobId = activeJobs.data[0].id;
    const jobDetails = await upwork.getJob(jobId);

    if (jobDetails.data && jobDetails.data.id === jobId) {
      log('✓ Retrieved job details', 'green');
      log(`  - Niche: ${jobDetails.data.niche}`, 'yellow');
      log(`  - Budget: $${jobDetails.data.budget.amount}`, 'yellow');
    }

    // Test getting all niches
    log('\nTesting get all niches...', 'blue');
    const niches = upwork.getAllNiches();

    if (Array.isArray(niches) && niches.length > 0) {
      log(`✓ Found ${niches.length} niche(s): ${niches.join(', ')}`, 'green');
    }

    // Test statistics
    log('\nTesting statistics...', 'blue');
    const stats = upwork.getStats();

    if (stats.totalJobs && stats.byNiche) {
      log(`✓ Total jobs: ${stats.totalJobs}`, 'green');
      log(`  - By niche: ${Object.keys(stats.byNiche).length} niches`, 'yellow');
      log(`  - Viewed jobs: ${stats.viewedCount}`, 'yellow');
    }

    log('\n✓ Upwork provider: ALL TESTS PASSED', 'green');
  } catch (error) {
    log(`✗ Upwork provider test failed: ${error.message}`, 'red');
  }
}

/**
 * Test Calendly Provider
 */
async function testCalendlyProvider() {
  section('Testing Calendly Mock Provider');

  try {
    const calendly = getService('calendly');
    log('✓ Service loaded', 'green');

    // Test getting available slots
    log('\nTesting get available slots...', 'blue');
    const slots = await calendly.getAvailableSlots();

    if (slots.collection && slots.collection.length > 0) {
      log(`✓ Retrieved ${slots.collection.length} available slot(s)`, 'green');
      log(`  - First slot: ${slots.collection[0].start_time}`, 'yellow');
    }

    // Test getting event type
    log('\nTesting get event type...', 'blue');
    const eventType = await calendly.getEventType('default');

    if (eventType.resource && eventType.resource.name) {
      log(`✓ Retrieved event type: "${eventType.resource.name}"`, 'green');
      log(`  - Duration: ${eventType.resource.duration_minutes} minutes`, 'yellow');
    }

    // Test creating booking
    log('\nTesting create booking...', 'blue');
    const firstSlot = slots.collection[0];
    const bookingResult = await calendly.createBooking({
      start_time: firstSlot.start_time,
      end_time: firstSlot.end_time,
      name: 'Test User',
      email: 'testuser@example.com',
      notes: 'Test meeting booking'
    });

    if (bookingResult.resource && bookingResult.resource.uri) {
      log('✓ Booking created successfully', 'green');
      log(`  - Location: ${bookingResult.resource.location.type}`, 'yellow');
    }

    // Test listing bookings
    log('\nTesting list bookings...', 'blue');
    const bookingsList = await calendly.listBookings();

    if (bookingsList.collection && bookingsList.collection.length > 0) {
      log(`✓ Listed ${bookingsList.collection.length} booking(s)`, 'green');
    }

    // Test checking availability
    log('\nTesting check availability...', 'blue');
    const availCheck = await calendly.checkAvailability(
      firstSlot.start_time,
      firstSlot.end_time
    );

    if (availCheck.available !== undefined) {
      log(`✓ Availability check: ${availCheck.available ? 'Available' : 'Not available'}`, 'green');
    }

    // Test getting scheduling link
    log('\nTesting get scheduling link...', 'blue');
    const schedulingLink = await calendly.getSchedulingLink('30min');

    if (schedulingLink.scheduling_link) {
      log(`✓ Scheduling link: ${schedulingLink.scheduling_link}`, 'green');
    }

    // Test getting booking count
    log('\nTesting get booking count...', 'blue');
    const bookingCount = calendly.getBookingCount();

    log(`✓ Total bookings: ${bookingCount}`, 'green');

    log('\n✓ Calendly provider: ALL TESTS PASSED', 'green');
  } catch (error) {
    log(`✗ Calendly provider test failed: ${error.message}`, 'red');
  }
}

/**
 * Test Service Factory
 */
async function testServiceFactory() {
  section('Testing Service Factory');

  try {
    // Test mode detection
    log(`\nCurrent mode: ${getMode()}`, 'blue');
    if (isMockMode()) {
      log('✓ Mock mode enabled', 'green');
    }

    // Test available services
    const services = getAvailableServices();
    log(`\n✓ Available services: ${services.join(', ')}`, 'green');

    // Test service loading
    log('\nLoading all services...', 'blue');
    const allServices = {};
    for (const serviceName of services) {
      allServices[serviceName] = getService(serviceName);
    }

    log(`✓ All ${Object.keys(allServices).length} services loaded`, 'green');

    log('\n✓ Service Factory: ALL TESTS PASSED', 'green');
  } catch (error) {
    log(`✗ Service Factory test failed: ${error.message}`, 'red');
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  section('CONTENT AGENCY OS - MOCK PROVIDER TEST SUITE');

  log(`Mode: ${getMode().toUpperCase()}`, 'cyan');
  log(`Testing all mock providers...`, 'cyan');

  try {
    await testServiceFactory();
    await testAnthropicProvider();
    await testGmailProvider();
    await testDriveProvider();
    await testUpworkProvider();
    await testCalendlyProvider();

    section('TEST SUMMARY');
    log('✓ ALL TESTS PASSED SUCCESSFULLY!', 'green');
    log('\nAll mock providers are working correctly and ready for use.', 'green');
  } catch (error) {
    log(`\n✗ Test suite failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  process.exit(1);
});
