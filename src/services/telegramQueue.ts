/**
 * Telegram Message Queue Service
 * 
 * Manages Telegram message jobs using BullMQ
 */

import { Queue, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { getRedisConfig } from '../config/redis.config';
import {
  TELEGRAM_MESSAGE_QUEUE,
  TELEGRAM_MESSAGE_JOB,
  TelegramMessageJobData,
} from '../types/job.types';

const connection = new IORedis(getRedisConfig());

const telegramQueue = new Queue<TelegramMessageJobData>(TELEGRAM_MESSAGE_QUEUE, {
  connection,
});

connection.on('error', (error: Error) => {
  console.error('Redis connection error for Telegram queue', error);
});

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: 100,
  removeOnFail: 50,
};

/**
 * Enqueue a Telegram message job
 */
export async function enqueueTelegramMessage(
  data: TelegramMessageJobData,
): Promise<void> {
  try {
    await telegramQueue.add(TELEGRAM_MESSAGE_JOB, data, DEFAULT_JOB_OPTIONS);
    console.log(`📱 Telegram message queued: ${data.type}`);
  } catch (error) {
    console.error('Failed to enqueue Telegram message:', error);
    throw error;
  }
}

/**
 * Get the Telegram message queue instance
 */
export function getTelegramQueue(): Queue<TelegramMessageJobData> {
  return telegramQueue;
}

