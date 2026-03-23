/**
 * Mock Google Drive Provider
 * Writes documents as .md files to ./tmp/mock_storage/documents/
 * All operations log to activity.json
 */

const fs = require('fs');
const path = require('path');

// Storage paths
const STORAGE_BASE = path.join(__dirname, '../../tmp/mock_storage');
const DOCUMENTS_DIR = path.join(STORAGE_BASE, 'documents');
const ACTIVITY_LOG = path.join(STORAGE_BASE, 'activity.json');

/**
 * Ensure storage directories exist
 */
function ensureStorageDirectories() {
  if (!fs.existsSync(STORAGE_BASE)) {
    fs.mkdirSync(STORAGE_BASE, { recursive: true });
  }
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
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
 * Generate a unique file ID
 * @returns {string} Unique file ID
 */
function generateFileId() {
  return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize filename
 * @param {string} filename - Filename to sanitize
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-z0-9_\-. ]/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .substring(0, 255);
}

/**
 * Format Drive API file object
 * @param {Object} fileData - File data
 * @returns {Object} Drive API formatted file
 */
function formatDriveFile(fileData) {
  return {
    kind: 'drive#file',
    id: fileData.id,
    name: fileData.name,
    mimeType: 'text/markdown',
    size: Buffer.byteLength(fileData.content),
    createdTime: fileData.createdTime,
    modifiedTime: fileData.modifiedTime,
    webViewLink: `https://drive.google.com/file/d/${fileData.id}/view`,
    webContentLink: `https://drive.google.com/uc?export=download&id=${fileData.id}`,
    owners: [
      {
        displayName: 'Mock User',
        emailAddress: 'mock@content-agency-os.local'
      }
    ],
    lastModifyingUser: {
      displayName: 'Mock User',
      emailAddress: 'mock@content-agency-os.local'
    },
    shared: fileData.shared || false,
    permissions: fileData.permissions || []
  };
}

/**
 * Mock Google Drive API provider
 */
class DriveMock {
  constructor(options = {}) {
    this.options = options;
    this.files = new Map();
    ensureStorageDirectories();
  }

  /**
   * Create a new document
   * @param {Object} document - Document to create
   * @param {string} document.name - Document name/title
   * @param {string} document.content - Document content (markdown)
   * @param {Object} document.metadata - Optional metadata
   * @returns {Promise<Object>} Created file details
   */
  async createDocument(document) {
    ensureStorageDirectories();

    const fileId = generateFileId();
    const timestamp = new Date().toISOString();
    const filename = `${sanitizeFilename(document.name)}_${fileId}.md`;

    const fileData = {
      id: fileId,
      name: document.name,
      content: document.content || '',
      createdTime: timestamp,
      modifiedTime: timestamp,
      shared: false,
      permissions: [],
      metadata: document.metadata || {}
    };

    // Write markdown file
    const filepath = path.join(DOCUMENTS_DIR, filename);
    fs.writeFileSync(filepath, document.content || '');

    // Store file data with metadata
    const metadataPath = filepath.replace('.md', '_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(fileData, null, 2));

    this.files.set(fileId, fileData);

    logActivity({
      action: 'create_document',
      fileId,
      fileName: document.name,
      size: Buffer.byteLength(document.content || ''),
      status: 'success'
    });

    return formatDriveFile(fileData);
  }

  /**
   * Update document content
   * @param {string} fileId - File ID to update
   * @param {string} content - New content
   * @returns {Promise<Object>} Updated file details
   */
  async updateDocument(fileId, content) {
    ensureStorageDirectories();

    const files = fs.readdirSync(DOCUMENTS_DIR).filter(f => f.includes(fileId) && f.endsWith('.md'));

    if (files.length === 0) {
      throw new Error(`Document not found: ${fileId}`);
    }

    const filepath = path.join(DOCUMENTS_DIR, files[0]);
    const metadataPath = filepath.replace('.md', '_metadata.json');

    // Update file content
    fs.writeFileSync(filepath, content);

    // Update metadata
    let fileData = this.files.get(fileId) || {};
    fileData.modifiedTime = new Date().toISOString();
    fileData.content = content;

    this.files.set(fileId, fileData);
    fs.writeFileSync(metadataPath, JSON.stringify(fileData, null, 2));

    logActivity({
      action: 'update_document',
      fileId,
      size: Buffer.byteLength(content),
      status: 'success'
    });

    return formatDriveFile(fileData);
  }

  /**
   * Upload a file
   * @param {Object} options - Upload options
   * @param {string} options.name - File name
   * @param {string} options.content - File content
   * @param {string} options.mimeType - MIME type
   * @returns {Promise<Object>} Uploaded file details
   */
  async uploadFile(options) {
    ensureStorageDirectories();

    const { name, content, mimeType = 'text/markdown' } = options;

    const fileId = generateFileId();
    const timestamp = new Date().toISOString();
    const filename = `${sanitizeFilename(name)}_${fileId}${path.extname(name)}`;

    const fileData = {
      id: fileId,
      name: name,
      content: content,
      mimeType: mimeType,
      createdTime: timestamp,
      modifiedTime: timestamp,
      shared: false,
      permissions: []
    };

    // Write file
    const filepath = path.join(DOCUMENTS_DIR, filename);
    fs.writeFileSync(filepath, content);

    // Store metadata
    const metadataPath = filepath.replace(path.extname(filepath), '_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(fileData, null, 2));

    this.files.set(fileId, fileData);

    logActivity({
      action: 'upload_file',
      fileId,
      fileName: name,
      mimeType,
      size: Buffer.byteLength(content),
      status: 'success'
    });

    return formatDriveFile(fileData);
  }

  /**
   * List files in Drive
   * @param {Object} options - Query options
   * @param {string} options.query - Drive API query string
   * @param {number} options.pageSize - Max files to return
   * @returns {Promise<Object>} List response with files
   */
  async listFiles(options = {}) {
    ensureStorageDirectories();

    const { query = '', pageSize = 10 } = options;
    let files = [];

    // Read all metadata files
    const mdFiles = fs.readdirSync(DOCUMENTS_DIR).filter(f => f.endsWith('_metadata.json'));

    mdFiles.forEach(file => {
      try {
        const content = fs.readFileSync(path.join(DOCUMENTS_DIR, file), 'utf-8');
        const fileData = JSON.parse(content);

        // Simple query matching
        if (query) {
          const queryLower = query.toLowerCase();
          if (!fileData.name.toLowerCase().includes(queryLower)) {
            return;
          }
        }

        files.push(fileData);
      } catch (error) {
        console.error(`Error reading file ${file}:`, error.message);
      }
    });

    // Sort by creation date descending (newest first)
    files.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

    logActivity({
      action: 'list_files',
      query,
      resultCount: Math.min(files.length, pageSize),
      status: 'success'
    });

    return {
      kind: 'drive#fileList',
      files: files.slice(0, pageSize).map(f => formatDriveFile(f)),
      pageSize: Math.min(files.length, pageSize)
    };
  }

  /**
   * Get file by ID
   * @param {string} fileId - File ID
   * @returns {Promise<Object>} File details
   */
  async getFile(fileId) {
    ensureStorageDirectories();

    const mdFiles = fs.readdirSync(DOCUMENTS_DIR).filter(f => f.includes(fileId) && f.endsWith('_metadata.json'));

    if (mdFiles.length === 0) {
      throw new Error(`File not found: ${fileId}`);
    }

    try {
      const content = fs.readFileSync(path.join(DOCUMENTS_DIR, mdFiles[0]), 'utf-8');
      const fileData = JSON.parse(content);

      logActivity({
        action: 'get_file',
        fileId,
        status: 'success'
      });

      return formatDriveFile(fileData);
    } catch (error) {
      throw new Error(`Error reading file: ${error.message}`);
    }
  }

  /**
   * Share a file with users
   * @param {string} fileId - File ID to share
   * @param {Array} users - Array of user emails to share with
   * @param {string} role - Permission role (reader, commenter, writer)
   * @returns {Promise<Object>} Updated permissions
   */
  async shareFile(fileId, users, role = 'reader') {
    ensureStorageDirectories();

    const mdFiles = fs.readdirSync(DOCUMENTS_DIR).filter(f => f.includes(fileId) && f.endsWith('_metadata.json'));

    if (mdFiles.length === 0) {
      throw new Error(`File not found: ${fileId}`);
    }

    try {
      const metadataPath = path.join(DOCUMENTS_DIR, mdFiles[0]);
      const content = fs.readFileSync(metadataPath, 'utf-8');
      const fileData = JSON.parse(content);

      // Add permissions for each user
      const newPermissions = users.map(email => ({
        kind: 'drive#permission',
        id: `permission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'user',
        role: role,
        emailAddress: email
      }));

      fileData.permissions = fileData.permissions || [];
      fileData.permissions.push(...newPermissions);
      fileData.shared = true;

      fs.writeFileSync(metadataPath, JSON.stringify(fileData, null, 2));
      this.files.set(fileId, fileData);

      logActivity({
        action: 'share_file',
        fileId,
        usersCount: users.length,
        role,
        status: 'success'
      });

      return {
        kind: 'drive#permissionList',
        permissions: newPermissions
      };
    } catch (error) {
      throw new Error(`Error sharing file: ${error.message}`);
    }
  }

  /**
   * Delete a file
   * @param {string} fileId - File ID to delete
   * @returns {Promise<void>}
   */
  async deleteFile(fileId) {
    ensureStorageDirectories();

    const files = fs.readdirSync(DOCUMENTS_DIR).filter(f => f.includes(fileId));

    files.forEach(file => {
      const filepath = path.join(DOCUMENTS_DIR, file);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });

    this.files.delete(fileId);

    logActivity({
      action: 'delete_file',
      fileId,
      status: 'success'
    });
  }

  /**
   * Get file content
   * @param {string} fileId - File ID
   * @returns {Promise<string>} File content
   */
  async getFileContent(fileId) {
    ensureStorageDirectories();

    const files = fs.readdirSync(DOCUMENTS_DIR).filter(f => f.includes(fileId) && f.endsWith('.md'));

    if (files.length === 0) {
      throw new Error(`File not found: ${fileId}`);
    }

    const content = fs.readFileSync(path.join(DOCUMENTS_DIR, files[0]), 'utf-8');
    return content;
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
      if (fs.existsSync(DOCUMENTS_DIR)) {
        fs.rmSync(DOCUMENTS_DIR, { recursive: true });
        fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
      }
      fs.writeFileSync(ACTIVITY_LOG, JSON.stringify([], null, 2));
      this.files.clear();

      logActivity({
        action: 'clear_storage',
        status: 'success'
      });
    } catch (error) {
      console.error('Error clearing storage:', error.message);
    }
  }
}

module.exports = DriveMock;
