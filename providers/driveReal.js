/**
 * Real Google Drive Provider
 * Uses googleapis to create/manage Google Docs and Drive files
 * Matches the mock provider interface: createDocument, updateDocument, uploadFile, etc.
 *
 * Shares OAuth2 credentials with Gmail:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

const { google } = require('googleapis');
const { Readable } = require('stream');
const logger = require('../utils/logger');

class DriveRealProvider {
  constructor(options = {}) {
    const clientId = options.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = options.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = options.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required. Set them in your .env file.'
      );
    }

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3001/api/auth/google/callback');

    if (refreshToken) {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    }

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.files = new Map();
    this.options = options;
  }

  /**
   * Create a new Google Doc
   * @param {Object} document - Document details
   * @param {string} document.name - Document title
   * @param {string} document.content - Document content (plain text/markdown)
   * @param {Object} document.metadata - Optional metadata
   * @returns {Promise<Object>} Created file details (matching mock format)
   */
  async createDocument(document) {
    try {
      // Create the Google Doc
      const fileMetadata = {
        name: document.name,
        mimeType: 'application/vnd.google-apps.document'
      };

      // Convert content to a readable stream
      const contentStream = new Readable();
      contentStream.push(document.content || '');
      contentStream.push(null);

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: 'text/plain',
          body: contentStream
        },
        fields: 'id, name, webViewLink, createdTime, modifiedTime, size, mimeType'
      });

      const file = response.data;

      logger.info(`[DriveReal] Created document "${document.name}": ${file.id}`);

      return {
        kind: 'drive#file',
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        size: file.size || String(Buffer.byteLength(document.content || '')),
        shared: false,
        permissions: []
      };
    } catch (error) {
      logger.error(`[DriveReal] Failed to create document: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update document content
   * @param {string} fileId - File ID
   * @param {string} content - New content
   * @returns {Promise<Object>} Updated file details
   */
  async updateDocument(fileId, content) {
    try {
      const contentStream = new Readable();
      contentStream.push(content);
      contentStream.push(null);

      const response = await this.drive.files.update({
        fileId,
        media: {
          mimeType: 'text/plain',
          body: contentStream
        },
        fields: 'id, name, webViewLink, createdTime, modifiedTime, size, mimeType'
      });

      const file = response.data;
      logger.info(`[DriveReal] Updated document ${fileId}`);

      return {
        kind: 'drive#file',
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        size: file.size || String(Buffer.byteLength(content)),
        shared: false,
        permissions: []
      };
    } catch (error) {
      logger.error(`[DriveReal] Failed to update document ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload a file to Drive
   * @param {Object} options - Upload options
   * @param {string} options.name - File name
   * @param {string} options.content - File content
   * @param {string} options.mimeType - MIME type
   * @returns {Promise<Object>} Uploaded file details
   */
  async uploadFile(options) {
    const { name, content, mimeType = 'text/markdown' } = options;

    try {
      const contentStream = new Readable();
      contentStream.push(content);
      contentStream.push(null);

      const response = await this.drive.files.create({
        requestBody: {
          name,
          mimeType
        },
        media: {
          mimeType,
          body: contentStream
        },
        fields: 'id, name, webViewLink, createdTime, modifiedTime, size, mimeType'
      });

      const file = response.data;
      logger.info(`[DriveReal] Uploaded file "${name}": ${file.id}`);

      return {
        kind: 'drive#file',
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        size: file.size || String(Buffer.byteLength(content)),
        shared: false,
        permissions: []
      };
    } catch (error) {
      logger.error(`[DriveReal] Failed to upload file: ${error.message}`);
      throw error;
    }
  }

  /**
   * List files in Drive
   * @param {Object} options - Query options
   * @param {string} options.query - Drive API query string
   * @param {number} options.pageSize - Max files to return
   * @returns {Promise<Object>} List response with files array
   */
  async listFiles(options = {}) {
    const { query = '', pageSize = 10 } = options;

    try {
      const params = {
        pageSize,
        fields: 'files(id, name, mimeType, webViewLink, createdTime, modifiedTime, size, shared, permissions)',
        orderBy: 'createdTime desc'
      };

      if (query) {
        params.q = `name contains '${query}'`;
      }

      const response = await this.drive.files.list(params);

      return {
        kind: 'drive#fileList',
        files: response.data.files || [],
        pageSize: (response.data.files || []).length
      };
    } catch (error) {
      logger.error(`[DriveReal] Failed to list files: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get file by ID
   * @param {string} fileId - File ID
   * @returns {Promise<Object>} File details
   */
  async getFile(fileId) {
    try {
      const response = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType, webViewLink, createdTime, modifiedTime, size, shared, permissions'
      });
      return response.data;
    } catch (error) {
      logger.error(`[DriveReal] Failed to get file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Share a file with users
   * @param {string} fileId - File ID
   * @param {Array} users - Array of email addresses
   * @param {string} role - Permission role (reader, commenter, writer)
   * @returns {Promise<Object>} Permission list
   */
  async shareFile(fileId, users, role = 'reader') {
    try {
      const permissions = [];

      for (const email of users) {
        const response = await this.drive.permissions.create({
          fileId,
          requestBody: {
            type: 'user',
            role,
            emailAddress: email
          }
        });
        permissions.push(response.data);
      }

      logger.info(`[DriveReal] Shared file ${fileId} with ${users.length} users`);

      return {
        kind: 'drive#permissionList',
        permissions
      };
    } catch (error) {
      logger.error(`[DriveReal] Failed to share file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a file
   * @param {string} fileId - File ID
   * @returns {Promise<void>}
   */
  async deleteFile(fileId) {
    try {
      await this.drive.files.delete({ fileId });
      logger.info(`[DriveReal] Deleted file ${fileId}`);
    } catch (error) {
      logger.error(`[DriveReal] Failed to delete file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get file content (exports Google Doc as plain text)
   * @param {string} fileId - File ID
   * @returns {Promise<string>} File content
   */
  async getFileContent(fileId) {
    try {
      const response = await this.drive.files.export({
        fileId,
        mimeType: 'text/plain'
      });
      return response.data;
    } catch (error) {
      // Fallback: try downloading as binary
      try {
        const response = await this.drive.files.get({
          fileId,
          alt: 'media'
        });
        return response.data;
      } catch (fallbackError) {
        logger.error(`[DriveReal] Failed to get file content ${fileId}: ${fallbackError.message}`);
        throw fallbackError;
      }
    }
  }

  /**
   * Get activity log (not applicable for real provider)
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
    logger.warn('[DriveReal] clearStorage called — no-op for real provider');
  }
}

module.exports = DriveRealProvider;
