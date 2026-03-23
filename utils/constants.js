module.exports = {
  JOB_STATUS: {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    ON_HOLD: 'on_hold'
  },

  QUALITY_LEVEL: {
    LOW: 1,
    MEDIUM: 2,
    STANDARD: 3,
    PROFESSIONAL: 4,
    PREMIUM: 5
  },

  CONTENT_TYPE: {
    BLOG_POST: 'blog_post',
    WHITEPAPER: 'whitepaper',
    CASE_STUDY: 'case_study',
    GUIDE: 'guide',
    FAQ: 'faq',
    EMAIL_CAMPAIGN: 'email_campaign',
    SOCIAL_MEDIA: 'social_media',
    VIDEO_SCRIPT: 'video_script',
    PODCAST_OUTLINE: 'podcast_outline',
    TECHNICAL_DOCUMENTATION: 'technical_documentation'
  },

  NICHE: {
    HR: 'HR',
    PEO: 'PEO',
    BENEFITS: 'benefits',
    COMPLIANCE: 'compliance'
  },

  ROLE: {
    ADMIN: 'admin',
    MANAGER: 'manager',
    ANALYST: 'analyst',
    READONLY: 'readonly'
  },

  ACTIVITY_TYPE: {
    JOB_CREATED: 'job_created',
    JOB_STARTED: 'job_started',
    JOB_COMPLETED: 'job_completed',
    JOB_FAILED: 'job_failed',
    OPPORTUNITY_FOUND: 'opportunity_found',
    OPPORTUNITY_APPLIED: 'opportunity_applied',
    TOKEN_USAGE: 'token_usage',
    COST_ALERT: 'cost_alert',
    USER_LOGIN: 'user_login',
    USER_LOGOUT: 'user_logout',
    SETTINGS_CHANGED: 'settings_changed',
    CONTENT_GENERATED: 'content_generated'
  },

  ERROR_CODE: {
    INVALID_REQUEST: 'INVALID_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    TIMEOUT: 'TIMEOUT'
  },

  COST_THRESHOLD: {
    WARNING: 0.80,
    CRITICAL: 0.95,
    HARD_LIMIT: 1.10
  },

  QUEUE_NAME: {
    JOBS: 'jobs',
    OPPORTUNITIES: 'opportunities',
    ANALYTICS: 'analytics',
    NOTIFICATIONS: 'notifications'
  },

  DEFAULTS: {
    PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    TIMEOUT_MS: 300000,
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 5000
  },

  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    INTERNAL_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
  }
};
