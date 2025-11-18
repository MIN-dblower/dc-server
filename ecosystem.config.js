module.exports = {
  apps: [
    {
      name: 'drive-monitor',
      script: 'build/workers/auctionMonitor.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'dc-sync',
      script: 'build/workers/dcSyncWorker.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'telegram-worker',
      script: 'build/workers/telegramWorker.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'queue-dashboard',
      script: 'build/workers/queueDashboard.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        BULL_BOARD_PORT: process.env.BULL_BOARD_PORT || '3001',
      },
    },
  ],
};

