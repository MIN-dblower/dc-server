/**
 * Telegram Message Processor
 * 
 * Processes Telegram message jobs from the queue
 */

import { Job } from 'bullmq';
import { TelegramMessageJobData } from '../types/job.types';
import { getTelegramService } from './telegramBot';

export async function processTelegramMessage(
  job: Job<TelegramMessageJobData>,
): Promise<void> {
  const { type, vin, question, vehicleTrim, jobId, error, queueLength, oldestJobTime, component, status, details } = job.data;
  const telegramService = getTelegramService();

  try {
    switch (type) {
      case 'uncovered_case':
        if (!vin || !question) {
          throw new Error('Missing required fields for uncovered_case alert');
        }
        const uncoveredMessage = `🚨 <b>Uncovered Case Detected</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          `Vehicle Trim: ${vehicleTrim || 'N/A'}\n` +
          `Question Key: <code>${question.key || 'N/A'}</code>\n` +
          `Question Type: <code>${question.type || 'N/A'}</code>\n` +
          `Question Book: <code>${question.book || 'N/A'}</code>\n` +
          `\n<b>⚠️ This VIN has been blocked from processing.</b>\n` +
          `Please review and implement the missing case, then unblock the VIN.\n\n` +
          `Time: ${new Date().toISOString()}\n\n` +
          `<pre>${JSON.stringify(question, null, 2).substring(0, 500)}</pre>`;
        await telegramService.sendMessage(uncoveredMessage);
        break;

      case 'blocked_vin_attempt':
        if (!vin || !details) {
          throw new Error('Missing required fields for blocked_vin_attempt alert');
        }
        const blockedMessage = `🚫 <b>Blocked VIN Processing Attempt</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          `Reason: ${details.reason}\n` +
          `Blocked At: ${details.timestamp}\n` +
          `\nThis VIN was skipped to prevent repeated failures.\n` +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(blockedMessage);
        break;

      case 'job_failure':
        if (!jobId || !vin || !error) {
          throw new Error('Missing required fields for job_failure alert');
        }
        const failureMessage = `❌ <b>DC Update Failed</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          `Job ID: <code>${jobId}</code>\n` +
          `Error: ${error}\n` +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(failureMessage);
        break;

      case 'queue_backup':
        if (queueLength === undefined) {
          throw new Error('Missing required fields for queue_backup alert');
        }
        const backupMessage = `⚠️ <b>Queue Backup Alert</b>\n\n` +
          `Queue Length: <b>${queueLength}</b>\n` +
          (oldestJobTime ? `Oldest Job: ${oldestJobTime}\n` : '') +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(backupMessage);
        break;

      case 'system_health':
        if (!component || !status) {
          throw new Error('Missing required fields for system_health alert');
        }
        const healthMessage = `🚨 <b>System Health Alert</b>\n\n` +
          `Component: <code>${component}</code>\n` +
          `Status: <b>${status}</b>\n` +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(healthMessage);
        break;

      default:
        throw new Error(`Unknown Telegram message type: ${type}`);
    }

    console.log(`✅ Telegram message sent: ${type}`);
  } catch (error) {
    console.error(`❌ Failed to process Telegram message (${type}):`, error);
    throw error;
  }
}

