/**
 * PM2 Ecosystem Configuration for Content Agency OS
 * Manages main server, scheduler, and development processes
 *
 * Usage:
 *   pm2 start ecosystem.config.js                 # Start all processes
 *   pm2 start ecosystem.config.js --only server   # Start specific process
 *   pm2 stop ecosystem.config.js                  # Stop all processes
 *   pm2 delete ecosystem.config.js                # Delete all processes
 *   pm2 monit                                     # Monitor processes
 *   pm2 logs                                      # View logs
 *   pm2 logs server                               # View specific log
 *   pm2 save                                      # Save process list
 *   pm2 resurrect                                 # Restore saved process list
 */

module.exports = {
  apps: [
    // Main Express Server
    {
      name: 'server',
      script: './server.js',
      version: '1.0.0',
      description: 'Content Agency OS Express Server',
      instances: 1,
      exec_mode: 'cluster',
      watch: process.env.NODE_ENV === 'development' ? ['server.js', 'routes/', 'utils/'] : false,
      watch_delay: 1000,
      ignore_watch: ['node_modules', 'tmp', 'data', 'logs', 'coverage', '.git'],
      max_memory_restart: '512M',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
        MOCK_MODE: process.env.MOCK_MODE || 'true',
        LOG_LEVEL: 'info'
      },

      // Production environment
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        MOCK_MODE: 'false',
        LOG_LEVEL: 'warn'
      },

      // Development environment
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
        MOCK_MODE: 'true',
        LOG_LEVEL: 'debug'
      },

      // Logging
      out_file: './logs/server.log',
      error_file: './logs/server-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      max_memory_restart: '512M',
      listen_timeout: 3000,
      kill_timeout: 5000,

      // Graceful shutdown
      wait_ready: true,
      listen_timeout: 3000,

      // Monitoring
      monitor_delay: 5000
    },

    // Job Scheduler Process
    {
      name: 'scheduler',
      script: './scheduler.js',
      version: '1.0.0',
      description: 'Content Agency OS Job Scheduler',
      instances: 1,
      exec_mode: 'fork',
      watch: process.env.NODE_ENV === 'development' ? ['scheduler.js', 'utils/'] : false,
      watch_delay: 1000,
      ignore_watch: ['node_modules', 'tmp', 'data', 'logs', 'coverage', '.git'],
      max_memory_restart: '256M',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        MOCK_MODE: process.env.MOCK_MODE || 'true',
        LOG_LEVEL: 'info',
        SCHEDULER_TICK_INTERVAL: 5000
      },

      // Production environment
      env_production: {
        NODE_ENV: 'production',
        MOCK_MODE: 'false',
        LOG_LEVEL: 'warn',
        SCHEDULER_TICK_INTERVAL: 10000
      },

      // Development environment
      env_development: {
        NODE_ENV: 'development',
        MOCK_MODE: 'true',
        LOG_LEVEL: 'debug',
        SCHEDULER_TICK_INTERVAL: 5000
      },

      // Logging
      out_file: './logs/scheduler.log',
      error_file: './logs/scheduler-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      max_memory_restart: '256M',
      listen_timeout: 3000,
      kill_timeout: 5000
    },

    // Development Watch Process (Optional)
    {
      name: 'watch',
      script: 'npm',
      args: 'run dev',
      version: '1.0.0',
      description: 'Development Mode with Nodemon',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,

      env: {
        NODE_ENV: 'development',
        PORT: 3001,
        MOCK_MODE: 'true',
        LOG_LEVEL: 'debug'
      },

      out_file: './logs/watch.log',
      error_file: './logs/watch-error.log',
      only_exec_watch_mode: true,
      instances: 0 // Disabled by default, enable with: pm2 start ecosystem.config.js --only watch
    }
  ],

  // Global settings
  deploy: {
    production: {
      user: 'node',
      host: 'your-production-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-repo/content-agency-os.git',
      path: '/var/www/content-agency-os',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production'
    },
    development: {
      user: 'node',
      host: 'your-dev-server.com',
      ref: 'origin/develop',
      repo: 'git@github.com:your-repo/content-agency-os.git',
      path: '/var/www/content-agency-os-dev',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env development'
    }
  },

  // Global settings for all apps
  max_restarts: 10,
  min_uptime: '30s',
  max_memory_restart: '512M',
  listen_timeout: 3000,
  kill_timeout: 5000
};

/**
 * PM2 Usage Examples:
 *
 * Development Mode (MOCK_MODE=true):
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only server
 *   pm2 logs server
 *   pm2 stop server
 *   pm2 restart server
 *   pm2 delete server
 *
 * Production Mode (MOCK_MODE=false):
 *   pm2 start ecosystem.config.js --env production
 *   NODE_ENV=production MOCK_MODE=false pm2 start ecosystem.config.js
 *
 * Monitoring:
 *   pm2 monit                    # Real-time monitoring
 *   pm2 logs                     # Show all logs
 *   pm2 logs server              # Show specific service logs
 *   pm2 logs server --tail       # Tail specific service logs
 *   pm2 status                   # Show process status
 *   pm2 info server              # Show process details
 *
 * Management:
 *   pm2 restart ecosystem.config.js
 *   pm2 reload ecosystem.config.js
 *   pm2 stop ecosystem.config.js
 *   pm2 delete ecosystem.config.js
 *   pm2 save                     # Save process list
 *   pm2 startup                  # Auto-restart on reboot
 *   pm2 unstartup                # Remove auto-restart
 *
 * Cluster Mode:
 *   pm2 start ecosystem.config.js -i max    # Use all CPU cores
 *   pm2 reload ecosystem.config.js          # Zero-downtime reload
 *
 * Environment Variables:
 *   PORT - Server port (default: 3001)
 *   MOCK_MODE - Use mock providers (default: true)
 *   NODE_ENV - Environment (development/production)
 *   LOG_LEVEL - Logging level (debug/info/warn/error)
 *
 * Log Files:
 *   ./logs/server.log - Main server output
 *   ./logs/server-error.log - Server errors
 *   ./logs/scheduler.log - Scheduler output
 *   ./logs/scheduler-error.log - Scheduler errors
 *   ./logs/watch.log - Dev watch mode output
 */
