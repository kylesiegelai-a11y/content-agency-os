/**
 * Mock Gmail Provider
 * All operations write to ./tmp/mock_storage/emails/
 * Inbox simulation reads from ./tmp/mock_storage/inbox/
 * All operations log to activity.json
 */

const fs = require('fs');
const path = require('path');

// Storage paths
const STORAGE_BASE = path.join(__dirname, '../../tmp/mock_storage');
const EMAILS_DIR = path.join(STORAGE_BASE, 'emails');
const INBOX_DIR = path.join(STORAGE_BASE, 'inbox');
const ACTIVITY_LOG = path.join(STORAGE_BASE, 'activity.json');

/**
 * Ensure storage directories exist
 */
function ensureStorageDirectories() {
  if (!fs.existsSync(STORAGE_BASE)) {
    fs.mkdirSync(STORAGE_BASE, { recursive: true });
  }
  if (!fs.existsSync(EMAILS_DIR)) {
    fs.mkdirSync(EMAILS_DIR, { recursive: true });
  }
  if (!fs.existsSync(INBOX_DIR)) {
    fs.mkdirSync(INBOX_DIR, { recursive: true });
  }
  if (!fs.existsSync(ACTIVITY_LOG)) {
    fs.writeFileSync(ACTIVITY_LOG, JSON.stringify([], null, 2));
  }
}

/**
 * Log activity to activity.json
 * @param {Object} activity - Activity details to log
 */
function logActivity(activity) {
  try {
    ensureStorageDirectories();
    let activities = [];

    if (fs.existsSync(ACTIVITY_LOG)) {
      const content = fs.readFileSync(ACTIVITY_LOG, 'utf-8');
      activities = JSON.parse(content || '[]');
    }

    activities.push({
      timestamp: new Date().toISOString(),
      ...activity
    });

    fs.writeFileSync(ACTIVITY_LOG, JSON.stringify(activities, null, 2));
  } catch (error) {
    console.error('Error logging activity:', error.message);
  }
}

/**
 * Generate a unique message ID
 * @returns {string} Unique message ID
 */
function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format Gmail API message object
 * @param {Object} emailData - Email data
 * @returns {Object} Gmail API formatted message
 */
function formatGmailMessage(emailData) {
  return {
    id: emailData.id,
    threadId: emailData.threadId,
    labelIds: emailData.labelIds || ['INBOX'],
    snippet: emailData.body.substring(0, 100) + '...',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: emailData.from },
        { name: 'To', value: emailData.to },
        { name: 'Subject', value: emailData.subject },
        { name: 'Date', value: emailData.date }
      ],
      body: {
        size: emailData.body.length,
        data: Buffer.from(emailData.body).toString('base64')
      }
    },
    sizeEstimate: emailData.body.length + 200,
    historyId: `${Date.now()}`
  };
}

/**
 * Mock Gmail API provider
 */
class GmailMock {
  constructor(options = {}) {
    this.options = options;
    this.messageCache = new Map();
    this.watchCallbacks = [];
    ensureStorageDirectories();
  }

  /**
   * Send a message
   * @param {Object} message - Message to send
   * @param {string} message.to - Recipient email
   * @param {string} message.from - Sender email
   * @param {string} message.subject - Email subject
   * @param {string} message.body - Email body
   * @returns {Promise<Object>} Sent message details
   */
  async sendMessage(message) {
    ensureStorageDirectories();

    const messageId = generateMessageId();
    const timestamp = new Date().toISOString();

    const emailData = {
      id: messageId,
      threadId: `thread_${messageId}`,
      from: message.from || 'mock@content-agency-os.local',
      to: message.to,
      subject: message.subject || '(no subject)',
      body: message.body || '',
      date: timestamp,
      read: false,
      labelIds: ['SENT']
    };

    // Write email JSON file
    const filename = `${timestamp.replace(/[:.]/g, '-')}_${messageId}.json`;
    const filepath = path.join(EMAILS_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(emailData, null, 2));

    // Log activity
    logActivity({
      action: 'send_message',
      messageId,
      to: message.to,
      subject: message.subject,
      status: 'success'
    });

    return {
      id: messageId,
      threadId: emailData.threadId,
      labelIds: ['SENT']
    };
  }

  /**
   * List messages from inbox
   * @param {Object} options - Query options
   * @param {string} options.query - Gmail search query
   * @param {number} options.maxResults - Max messages to return
   * @returns {Promise<Array>} Array of message objects
   */
  async listMessages(options = {}) {
    ensureStorageDirectories();

    const { query = '', maxResults = 10 } = options;
    const messages = [];

    // Read all emails from storage
    const files = fs.readdirSync(EMAILS_DIR).filter(f => f.endsWith('.json'));

    files.forEach(file => {
      try {
        const content = fs.readFileSync(path.join(EMAILS_DIR, file), 'utf-8');
        const emailData = JSON.parse(content);

        // Simple query matching
        if (query) {
          const queryLower = query.toLowerCase();
          const matches =
            emailData.subject.toLowerCase().includes(queryLower) ||
            emailData.body.toLowerCase().includes(queryLower) ||
            emailData.from.toLowerCase().includes(queryLower) ||
            emailData.to.toLowerCase().includes(queryLower);

          if (!matches) return;
        }

        messages.push(formatGmailMessage(emailData));
      } catch (error) {
        console.error(`Error reading email file ${file}:`, error.message);
      }
    });

    // Sort by date descending (newest first)
    messages.sort((a, b) => {
      const dateA = new Date(a.payload.headers.find(h => h.name === 'Date').value);
      const dateB = new Date(b.payload.headers.find(h => h.name === 'Date').value);
      return dateB - dateA;
    });

    logActivity({
      action: 'list_messages',
      query,
      resultCount: Math.min(messages.length, maxResults),
      status: 'success'
    });

    return messages.slice(0, maxResults);
  }

  /**
   * Get a specific message by ID
   * @param {string} messageId - Message ID to retrieve
   * @returns {Promise<Object>} Message object
   */
  async getMessage(messageId) {
    ensureStorageDirectories();

    const files = fs.readdirSync(EMAILS_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(EMAILS_DIR, file), 'utf-8');
        const emailData = JSON.parse(content);

        if (emailData.id === messageId) {
          logActivity({
            action: 'get_message',
            messageId,
            status: 'success'
          });

          return formatGmailMessage(emailData);
        }
      } catch (error) {
        console.error(`Error reading email file ${file}:`, error.message);
      }
    }

    logActivity({
      action: 'get_message',
      messageId,
      status: 'not_found'
    });

    throw new Error(`Message not found: ${messageId}`);
  }

  /**
   * Get inbox messages (convenience method)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of inbox messages
   */
  async getInbox(options = {}) {
    return this.listMessages({
      ...options,
      query: 'label:INBOX'
    });
  }

  /**
   * Watch inbox for new messages
   * Simulates Gmail push notifications
   * @param {Function} callback - Callback when new message arrives
   * @returns {Promise<Object>} Watch response
   */
  async watchInbox(callback) {
    if (typeof callback === 'function') {
      this.watchCallbacks.push(callback);
    }

    logActivity({
      action: 'watch_inbox',
      callbacksRegistered: this.watchCallbacks.length,
      status: 'success'
    });

    return {
      historyId: `${Date.now()}`,
      expiration: `${Date.now() + 24 * 60 * 60 * 1000}`
    };
  }

  /**
   * Simulate receiving a new inbox message
   * Triggers registered watch callbacks
   * @param {Object} message - Message to add to inbox
   * @returns {Promise<void>}
   */
  async simulateInboxMessage(message) {
    ensureStorageDirectories();

    const messageId = generateMessageId();
    const timestamp = new Date().toISOString();

    const emailData = {
      id: messageId,
      threadId: `thread_${messageId}`,
      from: message.from,
      to: message.to || 'user@content-agency-os.local',
      subject: message.subject,
      body: message.body,
      date: timestamp,
      read: false,
      labelIds: ['INBOX']
    };

    // Write to inbox directory
    const filename = `${timestamp.replace(/[:.]/g, '-')}_${messageId}.json`;
    const filepath = path.join(INBOX_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(emailData, null, 2));

    logActivity({
      action: 'simulate_inbox_message',
      messageId,
      from: message.from,
      subject: message.subject,
      status: 'success'
    });

    // Trigger watch callbacks
    const formattedMessage = formatGmailMessage(emailData);
    this.watchCallbacks.forEach(callback => {
      try {
        callback(formattedMessage);
      } catch (error) {
        console.error('Error in watch callback:', error.message);
      }
    });
  }

  /**
   * Mark message as read
   * @param {string} messageId - Message ID
   * @returns {Promise<Object>} Updated message
   */
  async markAsRead(messageId) {
    logActivity({
      action: 'mark_as_read',
      messageId,
      status: 'success'
    });

    return {
      id: messageId,
      labelIds: ['INBOX']
    };
  }

  /**
   * Delete message
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId) {
    logActivity({
      action: 'delete_message',
      messageId,
      status: 'success'
    });
  }

  /**
   * Get activity log
   * @returns {Promise<Array>} Activity log entries
   */
  async getActivityLog() {
    try {
      ensureStorageDirectories();
      const content = fs.readFileSync(ACTIVITY_LOG, 'utf-8');
      return JSON.parse(content || '[]');
    } catch (error) {
      console.error('Error reading activity log:', error.message);
      return [];
    }
  }

  /**
   * Clear all storage and logs
   * @returns {Promise<void>}
   */
  async clearStorage() {
    try {
      if (fs.existsSync(EMAILS_DIR)) {
        fs.rmSync(EMAILS_DIR, { recursive: true });
        fs.mkdirSync(EMAILS_DIR, { recursive: true });
      }
      if (fs.existsSync(INBOX_DIR)) {
        fs.rmSync(INBOX_DIR, { recursive: true });
        fs.mkdirSync(INBOX_DIR, { recursive: true });
      }
      fs.writeFileSync(ACTIVITY_LOG, JSON.stringify([], null, 2));

      logActivity({
        action: 'clear_storage',
        status: 'success'
      });
    } catch (error) {
      console.error('Error clearing storage:', error.message);
    }
  }
}

module.exports = GmailMock;
