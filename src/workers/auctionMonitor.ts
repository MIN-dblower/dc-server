import { AuctionMonitor } from '../services/auctionMonitor';
import { loadEnvConfig } from '../config/env.config';

// Initialize environment configuration
loadEnvConfig();

/**
 * Auction Monitor Worker
 * 
 * Monitors Google Drive folders for Adesa and Edge Pipeline auction files
 * and processes them according to the auction schedule
 */

function getEnvVar(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

async function main(): Promise<void> {
  console.log('🚀 Starting Auction Monitor Worker...\n');

  try {
    // DC update function is now called directly from dcUpdateInterface
    // No initialization needed

    // Get configuration from environment variables
    const adesaFolderId = getEnvVar('GOOGLE_DRIVE_ADESA_FOLDER_ID');
    const edgeFolderId = getEnvVar('GOOGLE_DRIVE_EDGE_FOLDER_ID');
    const pollIntervalMs = process.env.POLL_INTERVAL_MS
      ? parseInt(process.env.POLL_INTERVAL_MS, 10)
      : undefined;
    const cutoffTimeHours = process.env.CUTOFF_TIME_HOURS
      ? parseInt(process.env.CUTOFF_TIME_HOURS, 10)
      : undefined;

    // Create and start the monitor
    const monitor = new AuctionMonitor({
      adesaFolderId,
      edgeFolderId,
      pollIntervalMs,
      cutoffTimeHours,
    });

    monitor.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      monitor.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      monitor.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Failed to start Auction Monitor Worker:', error);
    if (error instanceof Error) {
      console.error(error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
