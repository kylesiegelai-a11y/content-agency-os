# Content Agency OS - Complete Setup Guide

Complete setup and deployment guide for Content Agency OS with production-ready configurations.

## Prerequisites

### System Requirements
- **Node.js**: 18.0.0 or higher (LTS recommended)
- **npm**: 9.0.0 or higher
- **RAM**: Minimum 512MB (1GB+ recommended)
- **Disk Space**: Minimum 500MB
- **Operating System**: Linux, macOS, or Windows (with WSL2)

### Optional Services
- **Redis**: For production queue management (optional in mock mode)
- **PostgreSQL**: For production data persistence (optional - file-based fallback available)
- **PM2**: For process management (recommended)

### API Keys (Production Only)
- **Anthropic**: API key for Claude models
- **Google Cloud**: For Gmail and Drive integration
- **Upwork**: For opportunity discovery
- **Calendly**: For scheduling

## Quick Start (Development)

Get the system running in under 60 seconds with mock providers:

### Step 1: Clone and Setup

```bash
# Navigate to project directory
cd /path/to/content-agency-os

# Install dependencies
npm install

# Create logs directory
mkdir -p logs

# Start the system
npm start
```

**Result**: System running in mock mode on `http://localhost:3001`

### Step 2: Verify Installation

```bash
# In a new terminal, run the smoke test
node scripts/smokeTest.js

# Expected output: All tests pass in under 60 seconds
```

### Step 3: Test the Pipeline

```bash
# Run the full Jest test suite
npm test

# Run only pipeline tests
npm test -- tests/mockPipeline.test.js

# Run with coverage
npm test -- --coverage
```

## Mock Mode

### What is Mock Mode?

Mock mode simulates all external services without requiring real credentials. Perfect for:
- Development and testing
- Learning the system
- Continuous integration pipelines
- Demonstrations

### How to Enable Mock Mode

```bash
# Enable via environment variable
MOCK_MODE=true npm start

# Or set in .env file
echo "MOCK_MODE=true" >> .env
npm start
```

### Mock Provider Behavior

| Provider | Status | Behavior |
|----------|--------|----------|
| **Anthropic (Claude)** | ✓ Mocked | Returns realistic dummy content |
| **Gmail** | ✓ Mocked | Stores emails in `tmp/mock_storage/emails/` |
| **Google Drive** | ✓ Mocked | Stores files in `tmp/mock_storage/documents/` |
| **Upwork** | ✓ Mocked | Uses `mock/test_opportunities.json` |
| **Calendly** | ✓ Mocked | Generates mock availability |

### Simulating Inbound Emails

Edit `mock/test_opportunities.json` to add new test opportunities:

```json
[
  {
    "id": "job_custom_001",
    "title": "Your custom project",
    "description": "Project description here",
    "niche": "your_niche",
    "budget": { "type": "fixed", "amount": 5000 },
    "duration": "1_to_3_months",
    "experience_level": "intermediate",
    "skills": ["skill1", "skill2"],
    "posted_at": "2026-03-22T10:00:00Z",
    "client": {
      "name": "Your Client Name",
      "rating": 4.8,
      "reviews": 50
    }
  }
]
```

Then restart the server:
```bash
npm start
```

The opportunity will be discovered and enter the pipeline automatically.

### Reading Mock Output

Mock provider output is stored in:

- **Emails**: `tmp/mock_storage/emails/*.json`
- **Documents**: `tmp/mock_storage/documents/*.md`
- **Activities**: `data/activity.json`
- **Jobs**: `data/jobs.json`

View the job status:
```bash
cat data/jobs.json | jq '.[] | {id, state, status}'
```

### Switching to Production

To transition from mock to production:

```bash
# Update .env file
MOCK_MODE=false
ANTHROPIC_API_KEY=your_key_here
GMAIL_API_KEY=your_key_here
DRIVE_API_KEY=your_key_here
UPWORK_API_KEY=your_key_here

# Restart
npm start
```

## Provider Configuration

### Mock Providers (No Setup Required)

All mock providers are included. They automatically activate when `MOCK_MODE=true`.

```javascript
// Automatic fallback in mock mode
const provider = MOCK_MODE
  ? require('./mock/providers/anthropicMock')
  : require('./providers/anthropic');
```

### Production Providers

#### Anthropic Setup

1. **Get API Key**:
   - Visit https://console.anthropic.com
   - Create an API key
   - Set in `.env`:
     ```
     ANTHROPIC_API_KEY=sk-ant-...
     ANTHROPIC_MODEL=claude-opus-4-1
     ```

2. **Configure Rate Limits**:
   ```javascript
   // In utils/apiClient.js
   const RATE_LIMITS = {
     requestsPerMinute: 100,
     tokensPerMinute: 50000
   };
   ```

#### Gmail Setup

1. **Enable Gmail API**:
   - Go to Google Cloud Console
   - Create OAuth 2.0 credentials
   - Download JSON credentials

2. **Configure in .env**:
   ```
   GMAIL_API_KEY=path/to/credentials.json
   GMAIL_EMAIL=your-email@gmail.com
   ```

#### Google Drive Setup

1. **Enable Drive API**:
   - Same Google Cloud project as Gmail
   - Create service account for Drive access

2. **Configure in .env**:
   ```
   DRIVE_API_KEY=path/to/drive-credentials.json
   DRIVE_FOLDER_ID=your-folder-id
   ```

#### Upwork Setup

1. **Get OAuth Credentials**:
   - Register application at developer.upwork.com
   - Get Consumer Key and Secret

2. **Configure in .env**:
   ```
   UPWORK_CONSUMER_KEY=your_key
   UPWORK_CONSUMER_SECRET=your_secret
   UPWORK_TOKEN=your_token
   UPWORK_TOKEN_SECRET=your_token_secret
   ```

#### Calendly Setup

1. **Generate Personal Access Token**:
   - Account Settings → Integrations → API & Webhooks
   - Create personal access token

2. **Configure in .env**:
   ```
   CALENDLY_API_KEY=your_token
   CALENDLY_USER_URI=your_user_uri
   ```

### Provider Health Check

```bash
# Test all providers
curl http://localhost:3001/api/health

# Expected response
{
  "status": "healthy",
  "providers": {
    "anthropic": "ok",
    "gmail": "ok",
    "drive": "ok",
    "upwork": "ok",
    "calendly": "ok"
  },
  "mockMode": true
}
```

## Production Setup

### 1. Database Migration

Switch from file-based storage to PostgreSQL:

```bash
# Install PostgreSQL client
npm install pg

# Create database
createdb content_agency_os

# Create schema
npm run migrate:latest
```

### 2. Environment Configuration

Create `.env.production`:

```bash
NODE_ENV=production
MOCK_MODE=false
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/content_agency_os

# API Keys
ANTHROPIC_API_KEY=sk-ant-...
GMAIL_API_KEY=...
DRIVE_API_KEY=...
UPWORK_API_KEY=...
CALENDLY_API_KEY=...

# Redis (optional, for queue management)
REDIS_URL=redis://localhost:6379

# Server
JWT_SECRET=very-long-random-string-min-32-chars
ADMIN_PASSWORD=secure-admin-password

# Logging
LOG_LEVEL=warn
LOG_FILE=./logs/server.log
```

### 3. Install PM2 Globally

```bash
npm install -g pm2

# Verify installation
pm2 --version
```

### 4. Deploy with PM2

```bash
# Start both server and scheduler
pm2 start ecosystem.config.js --env production

# Check status
pm2 status

# View logs
pm2 logs server
pm2 logs scheduler

# Save process list
pm2 save

# Enable auto-restart on reboot
pm2 startup
pm2 save
```

### 5. Set Up Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/content-agency-os
upstream api_backend {
  server 127.0.0.1:3001;
}

server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://api_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/content-agency-os /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 6. SSL/TLS with Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --nginx -d your-domain.com

# Auto-renew
sudo systemctl enable certbot.timer
```

### 7. Monitoring

```bash
# Real-time monitoring
pm2 monit

# Send logs to a service
pm2 install pm2-logrotate
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:compress true
```

## PostgreSQL Migration Path

### Step 1: Enable PostgreSQL

```javascript
// utils/storage.js
const usePostgres = process.env.DATABASE_URL;

if (usePostgres) {
  // Use PostgreSQL adapter
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  exports.read = async (tableName) => {
    const result = await pool.query(
      'SELECT data FROM $1 WHERE id = $2',
      [tableName, key]
    );
    return result.rows[0]?.data;
  };
} else {
  // Use existing file-based storage
}
```

### Step 2: Schema Creation

```sql
-- Create tables
CREATE TABLE jobs (
  id VARCHAR PRIMARY KEY,
  state VARCHAR NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE activity_log (
  id SERIAL PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  event_type VARCHAR NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ledger (
  id SERIAL PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  type VARCHAR NOT NULL,
  amount DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_jobs_state ON jobs(state);
CREATE INDEX idx_jobs_created ON jobs(created_at);
CREATE INDEX idx_activity_job ON activity_log(job_id);
```

### Step 3: Data Migration

```bash
# Run migration script
npm run migrate:data

# This script:
# 1. Reads all data/*.json files
# 2. Inserts into PostgreSQL
# 3. Validates record counts
# 4. Creates backups
```

## Troubleshooting

### Issue: Port 3001 Already in Use

```bash
# Find and kill process using port 3001
lsof -i :3001
kill -9 <PID>

# Or use a different port
PORT=3002 npm start
```

### Issue: Mock Providers Not Loading

```bash
# Verify MOCK_MODE environment variable
echo $MOCK_MODE

# Check file permissions
ls -la mock/providers/

# Restart server
npm start
```

### Issue: Database Connection Error

```bash
# Test PostgreSQL connection
psql $DATABASE_URL -c "SELECT 1"

# Check if Redis is running (if configured)
redis-cli ping

# Verify environment variables
grep DATABASE_URL .env
```

### Issue: Out of Memory

```bash
# Check memory usage
pm2 monit

# Increase Node memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm start

# Or in PM2
pm2 start server.js --max-memory-restart 512M
```

### Issue: Tests Failing

```bash
# Run with verbose output
npm test -- --verbose

# Run specific test file
npm test -- tests/mockPipeline.test.js

# Check for environment issues
npm test -- --detectOpenHandles --forceExit
```

## Performance Optimization

### 1. Enable Caching

```javascript
// In server.js
const redis = require('redis');
const client = redis.createClient({
  host: 'localhost',
  port: 6379
});

app.use((req, res, next) => {
  const cached = client.get(req.originalUrl);
  if (cached) {
    return res.json(JSON.parse(cached));
  }
  next();
});
```

### 2. Implement Rate Limiting

```bash
npm install express-rate-limit

# In server.js
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);
```

### 3. Database Query Optimization

```sql
-- Add indexes for common queries
CREATE INDEX idx_jobs_state_created ON jobs(state, created_at DESC);
CREATE INDEX idx_activity_job_type ON activity_log(job_id, event_type);
```

### 4. Monitor with PM2+

```bash
npm install -g pm2-plus
pm2 plus

# View real-time metrics at https://pm2.io/
```

## Security Best Practices

1. **Environment Variables**: Never commit `.env` files
2. **API Keys**: Rotate regularly, use different keys per environment
3. **JWT Secrets**: Use 32+ character random strings
4. **HTTPS**: Always use in production
5. **CORS**: Configure specific allowed origins
6. **Rate Limiting**: Protect endpoints from abuse
7. **Input Validation**: Validate all incoming data
8. **Logging**: Don't log sensitive data

## Deployment Checklist

- [ ] Node.js 18+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] Environment variables configured (`.env`)
- [ ] Database created and migrated
- [ ] Mock tests passing (`npm test`)
- [ ] Smoke test passing (`node scripts/smokeTest.js`)
- [ ] PM2 installed globally
- [ ] PM2 processes started
- [ ] Nginx configured as reverse proxy
- [ ] SSL/TLS certificate installed
- [ ] Monitoring enabled
- [ ] Backup strategy implemented
- [ ] Logs configured and rotating
- [ ] Health checks monitored
- [ ] Error alerts configured

## Support and Resources

- **Documentation**: See `SYSTEM_ARCHITECTURE.md`
- **API Reference**: See `server.js` for endpoint documentation
- **Agent Prompts**: See `agents/prompts/` directory
- **Issues**: Check `TROUBLESHOOTING.md`

## Version Information

- **Content Agency OS**: 1.0.0
- **Node.js**: 18.0.0+
- **npm**: 9.0.0+
- **PM2**: 5.3.0+ (recommended)

## License

Content Agency OS is proprietary software. Unauthorized copying or distribution is prohibited.

---

**Last Updated**: March 22, 2026
**Maintainer**: KAIL Data Services
