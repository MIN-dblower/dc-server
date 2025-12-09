/**
 * Blocked VINs Service
 * 
 * Manages VINs that are blocked from processing due to uncovered cases or errors.
 * Uses Redis for persistence across restarts.
 */

import IORedis from 'ioredis';
import { getRedisConfig } from '../config/redis.config';

const BLOCKED_VINS_KEY = 'blocked:vins';
const BLOCKED_VIN_DETAILS_KEY = (vin: string) => `blocked:vin:${vin}`;

// Redis connection for blocked VINs (separate from BullMQ connection)
let redisClient: IORedis | null = null;

function getRedisClient(): IORedis {
  if (!redisClient) {
    redisClient = new IORedis(getRedisConfig());
    redisClient.on('error', (error: Error) => {
      console.error('Redis connection error for blocked VINs service', error);
    });
  }
  return redisClient;
}

export interface BlockedVinDetails {
  vin: string;
  reason: string;
  question?: any; // The question object that caused the block
  timestamp: string;
  errorMessage?: string;
}

/**
 * Check if a VIN is blocked
 */
export async function isVinBlocked(vin: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    const isBlocked = await client.sismember(BLOCKED_VINS_KEY, vin);
    return isBlocked === 1;
  } catch (error) {
    console.error(`Error checking if VIN ${vin} is blocked:`, error);
    // On error, assume not blocked to avoid blocking legitimate processing
    return false;
  }
}

/**
 * Get details about why a VIN is blocked
 */
export async function getBlockedVinDetails(vin: string): Promise<BlockedVinDetails | null> {
  try {
    const client = getRedisClient();
    const detailsJson = await client.get(BLOCKED_VIN_DETAILS_KEY(vin));
    if (!detailsJson) {
      return null;
    }
    return JSON.parse(detailsJson) as BlockedVinDetails;
  } catch (error) {
    console.error(`Error getting blocked VIN details for ${vin}:`, error);
    return null;
  }
}

/**
 * Block a VIN from processing
 * Also pauses any jobs for this VIN to prevent retries
 */
export async function blockVin(
  vin: string,
  reason: string,
  question?: any,
  errorMessage?: string,
): Promise<void> {
  try {
    const client = getRedisClient();
    const details: BlockedVinDetails = {
      vin,
      reason,
      question,
      timestamp: new Date().toISOString(),
      errorMessage,
    };

    // Add VIN to blocked set
    await client.sadd(BLOCKED_VINS_KEY, vin);

    // Store details with no expiration (manual unblock required)
    await client.set(BLOCKED_VIN_DETAILS_KEY(vin), JSON.stringify(details));

    console.log(`🚫 VIN ${vin} has been blocked. Reason: ${reason}`);

    // Pause any jobs for this VIN to prevent retries
    // Use dynamic import to avoid circular dependency
    try {
      const { pauseJobsForBlockedVin } = await import('./jobQueue');
      const pausedCount = await pauseJobsForBlockedVin(vin);
      if (pausedCount > 0) {
        console.log(`⏸️  Paused ${pausedCount} job(s) for blocked VIN ${vin}`);
      }
    } catch (pauseError) {
      // Log but don't fail the block operation if pausing fails
      console.warn(
        `⚠️  Could not pause jobs for blocked VIN ${vin}:`,
        pauseError instanceof Error ? pauseError.message : pauseError,
      );
    }
  } catch (error) {
    console.error(`Error blocking VIN ${vin}:`, error);
    throw error;
  }
}

/**
 * Unblock a VIN (manual intervention)
 * Also resumes any paused jobs for this VIN
 */
export async function unblockVin(vin: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.srem(BLOCKED_VINS_KEY, vin);
    await client.del(BLOCKED_VIN_DETAILS_KEY(vin));
    console.log(`✅ VIN ${vin} has been unblocked`);

    // Resume any paused jobs for this VIN
    // Use dynamic import to avoid circular dependency
    const { resumeJobsForUnblockedVin } = await import('./jobQueue');
    const resumedCount = await resumeJobsForUnblockedVin(vin);
    if (resumedCount > 0) {
      console.log(`▶️  Resumed ${resumedCount} job(s) for unblocked VIN ${vin}`);
    }
  } catch (error) {
    console.error(`Error unblocking VIN ${vin}:`, error);
    throw error;
  }
}

/**
 * Get all blocked VINs
 */
export async function getAllBlockedVins(): Promise<string[]> {
  try {
    const client = getRedisClient();
    return await client.smembers(BLOCKED_VINS_KEY);
  } catch (error) {
    console.error('Error getting all blocked VINs:', error);
    return [];
  }
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeBlockedVinsService(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

