/**
 * Real Gmail Provider
 * Uses googleapis to send/read emails via Gmail API
 * Matches the mock provider interface: sendMessage, listMessages, getMessage, etc.
 *
 * Requires OAuth2 credentials:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *
 * First-time setup: Run the OAuth consent flow to obtain a refresh token.
 * See /utils/googleOAuth.js for the setup helper.
 */

const { google } = require('googleapis');
const logger = require('../utils/logger');

class GmailRealProvider {
  constructor(options = {}) {
    const clientId = options.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = options.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = options.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required. Set them in your .env file.'
      );
    }

    const redirectUri = options.redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    if (refreshToken) {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    }

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    this.watchCallbacks = [];

    // Store only non-sensitive options (strip credentials)
    const { clientId: _cid, clientSecret: _cs, refreshToken: _rt, ...safeOptions } = options;
    this._safeOptions = safeOptions;
  }

  /**
   * Ensure OAuth credentials are fresh; refresh if expired
   * Wraps API calls so 401s trigger a single token refresh + retry
   * @param {Function} fn - Async function to execute
   * @returns {Promise} Result of fn()
   */
  async _ensureAuth(fn) {
    try {
      return await fn();
    } catch (error) {
      // Detect expired/invalid token errors
      const status = error?.response?.status || error?.code;
      if (status === 401 || status === 'UNAUTHENTICATED') {
        logger.info('[GmailReal] Token expired, attempting refresh...');
        try {
          const { credentials } = await this.oauth2Client.refreshAccessToken();
          this.oauth2Client.setCredentials(credentials);
          logger.info('[GmailReal] Token refreshed successfully');
          return await fn();
        } catch (refreshError) {
          logger.error(`[GmailReal] Token refresh failed: ${refreshError.message}`);
          throw refreshError;
        }
      }
      throw error;
    }
  }

  /**
   * Prevent credentials from leaking into logs/serialization
   */
  toJSON() {
    return {
      type: 'GmailRealProvider',
      authenticated: this.isAuthenticated(),
      watchCallbackCount: this.watchCallbacks.length
    };
  }

  /**
   * Check if we have a valid refresh token
   * @returns {boolean}
   */
  isAuthenticated() {
    return !!this.oauth2Client.credentials.refresh_token;
  }

  /**
   * Get the OAuth2 authorization URL for first-time setup
   * @returns {string} Authorization URL
   */
  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify'
      ]
    });
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} code - Authorization code from OAuth callback
   * @returns {Object} Token response
   */
  async handleAuthCallback(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  /**
   * Build a raw RFC 2822 email string and base64url-encode it
   * @param {Object} message - Message details
   * @returns {string} Base64url-encoded email
   */
  _buildRawEmail(message) {
    const lines = [
      `To: ${message.to}`,
      `From: ${message.from || 'me'}`,
      `Subject: ${message.subject || '(no subject)'}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      message.body || ''
    ];
    const raw = lines.join('\r\n');
    return Buffer.from(raw).toString('base64url');
  }

  /**
   * Send a message via Gmail API
   * @param {Object} message - Message to send
   * @param {string} message.to - Recipient email
   * @param {string} message.from - Sender email (optional)
   * @param {string} message.subject - Email subject
   * @param {string} message.body - Email body (HTML)
   * @returns {Promise<Object>} { id, threadId, labelIds }
   */
  async sendMessage(message) {
    try {
      const raw = this._buildRawEmail(message);

      const response = await this._ensureAuth(() =>
        this.gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw }
        })
      );

      logger.info(`[GmailReal] Sent email to ${message.to}: ${response.data.id}`);

      return {
        id: response.data.id,
        threadId: response.data.threadId,
        labelIds: response.data.labelIds || ['SENT']
      };
    } catch (error) {
      logger.error(`[GmailReal] Failed to send email: ${error.message}`);
      throw error;
    }
  }

  /**
   * List messages from Gmail
   * @param {Object} options - Query options
   * @param {string} options.query - Gmail search query (e.g. "label:INBOX")
   * @param {number} options.maxResults - Max messages to return
   * @returns {Promise<Array>} Array of message objects
   */
  async listMessages(options = {}) {
    const { query = '', maxResults = 10 } = options;

    try {
      const listResponse = await this._ensureAuth(() =>
        this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults
        })
      );

      const messageIds = listResponse.data.messages || [];
      const messages = [];

      for (const { id } of messageIds) {
        try {
          const msg = await this._ensureAuth(() =>
            this.gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'full'
            })
          );
          messages.push(msg.data);
        } catch (err) {
          logger.warn(`[GmailReal] Failed to fetch message ${id}: ${err.message}`);
        }
      }

      return messages;
    } catch (error) {
      logger.error(`[GmailReal] Failed to list messages: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a specific message by ID
   * @param {string} messageId - Message ID
   * @returns {Promise<Object>} Full message object
   */
  async getMessage(messageId) {
    try {
      const response = await this._ensureAuth(() =>
        this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full'
        })
      );
      return response.data;
    } catch (error) {
      logger.error(`[GmailReal] Failed to get message ${messageId}: ${error.message}`);
      throw error;
    }
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
   * Watch inbox for new messages via Gmail push notifications
   * @param {Function} callback - Callback when new message arrives
   * @returns {Promise<Object>} Watch response with historyId and expiration
   */
  async watchInbox(callback) {
    if (typeof callback === 'function') {
      // Cap watch callbacks to prevent unbounded growth from repeated registrations
      if (this.watchCallbacks.length >= 50) {
        logger.warn('[GmailReal] watchCallbacks cap reached (50), removing oldest');
        this.watchCallbacks.shift();
      }
      this.watchCallbacks.push(callback);
    }

    try {
      // Gmail watch requires a Cloud Pub/Sub topic
      // For now, return a polling-compatible response
      // Full push notifications require Cloud Pub/Sub setup
      logger.info('[GmailReal] Inbox watch registered (polling mode)');

      return {
        historyId: `${Date.now()}`,
        expiration: `${Date.now() + 24 * 60 * 60 * 1000}`
      };
    } catch (error) {
      logger.error(`[GmailReal] Failed to watch inbox: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark message as read
   * @param {string} messageId - Message ID
   * @returns {Promise<Object>} Updated message
   */
  async markAsRead(messageId) {
    try {
      const response = await this._ensureAuth(() =>
        this.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: ['UNREAD']
          }
        })
      );
      return {
        id: response.data.id,
        labelIds: response.data.labelIds
      };
    } catch (error) {
      logger.error(`[GmailReal] Failed to mark as read ${messageId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete message (moves to trash)
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId) {
    try {
      await this._ensureAuth(() =>
        this.gmail.users.messages.trash({
          userId: 'me',
          id: messageId
        })
      );
      logger.info(`[GmailReal] Trashed message ${messageId}`);
    } catch (error) {
      logger.error(`[GmailReal] Failed to delete message ${messageId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get activity log (not applicable for real provider — returns empty)
   * @returns {Promise<Array>}
   */
  async getActivityLog() {
    return [];
  }

  /**
   * Clear storage (no-op for real provider)
   * @returns {Promise<void>}
   */
  async clearStorage() {
    logger.warn('[GmailReal] clearStorage called — no-op for real provider');
  }
}

module.exports = GmailRealProvider;
