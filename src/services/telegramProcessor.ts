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
  const { type, vin, question, vehicleTrim, jobId, error, queueLength, oldestJobTime, component, status, details, email, errorType, timestamp } = job.data;
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
          (vin ? `VIN: <code>${vin}</code>\n` : '') +
          `Status: <b>${status}</b>\n` +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(healthMessage);
        break;

      case 'auto_selection_mode':
        if (!vin || !details) {
          throw new Error('Missing required fields for auto_selection_mode alert');
        }
        const selectionKey = details.key || 'unknown';
        const selectionType = selectionKey === 'transmission' ? 'Transmission' : 
                             selectionKey === 'trim' ? 'Trim' : 
                             selectionKey.charAt(0).toUpperCase() + selectionKey.slice(1);
        
        const autoSelectionMessage = `🤖 <b>Auto Selection Mode</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          `Selection Key: <code>${selectionKey}</code>\n` +
          `Vehicle Trim: ${vehicleTrim || 'N/A'}\n` +
          `Message: ${details.message || 'N/A'}\n` +
          `Selected ${selectionType}: <b>${details.selectedOption?.name || 'N/A'}</b>\n` +
          `Available Options: ${details.availableOptions?.length || 0}\n` +
          (details.auctionType ? `Auction Type: ${details.auctionType}\n` : '') +
          (details.inventoryId ? `Inventory ID: <code>${details.inventoryId}</code>\n` : '') +
          `\nTime: ${new Date().toISOString()}`;
        await telegramService.sendMessage(autoSelectionMessage);
        break;

      case 'mfa_required':
        const mfaMessage = `🔐 <b>MFA Needed</b>\n\n` +
          (component ? `Source: <code>${component}</code>\n` : '') +
          (vin ? `VIN: <code>${vin}</code>\n` : '') +
          `DealerCenter login hit an MFA challenge and requires manual verification.\n` +
          `Please log in manually to complete MFA and unblock the sync worker.\n\n` +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(mfaMessage);
        break;

      case 'dc_sync_completed':
        const dcSyncDetails = job.data.dcSyncDetails;
        if (!vin || !dcSyncDetails) {
          throw new Error('Missing required fields for dc_sync_completed notification');
        }
        const { compFilters, pricingSummary } = dcSyncDetails;
        const odometerMin = compFilters.odometerMin ?? 0;
        const odometerMax = compFilters.odometerMax?.toLocaleString() ?? 'MAX';
        const odometerRange = `${Math.max(0, odometerMin).toLocaleString()} - ${odometerMax} mi`;
        
        const dcSyncMessage = `✅ <b>DC Sync Completed</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          `Inventory ID: <code>${dcSyncDetails.inventoryId}</code>\n` +
          `Auction: ${dcSyncDetails.auctionType} - ${dcSyncDetails.auctionLocation}\n` +
          `Odometer: ${dcSyncDetails.odometer.toLocaleString()} mi\n\n` +
          `<b>Comp Filters:</b>\n` +
          `  Odometer Range: ${odometerRange}\n` +
          `  Radius: ${compFilters.radiusInMiles} mi from auction\n` +
          (compFilters.years?.length ? `  Years: ${compFilters.years.join(', ')}\n` : '') +
          (compFilters.trims?.length ? `  Trims: ${compFilters.trims.join(', ')}\n` : '') +
          (pricingSummary ? `\n<b>Pricing:</b>\n` +
            `  Market Avg: $${pricingSummary.marketAveragePrice.toLocaleString()}\n` +
            `  Asking: $${pricingSummary.askingPrice.toLocaleString()}\n` +
            `  Appraisal: $${pricingSummary.appraisalValue.toLocaleString()}\n` +
            `  Recon Cost: $${pricingSummary.reconCost.toLocaleString()}\n` : '') +
          `\nTime: ${new Date().toISOString()}`;
        await telegramService.sendMessage(dcSyncMessage);
        break;

      case 'no_comp_found':
        if (!vin) {
          throw new Error('Missing required fields for no_comp_found alert');
        }
        const noCompMessage = `🔍 <b>No Comparables Found</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          (details?.vehicleCount !== undefined ? `Vehicle Count: ${details.vehicleCount}\n` : '') +
          (details?.inventoryId ? `Inventory ID: <code>${details.inventoryId}</code>\n` : '') +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(noCompMessage);
        break;

      case 'no_vehicle_data':
        if (!vin) {
          throw new Error('Missing required fields for no_vehicle_data alert');
        }
        const noVehicleDataMessage = `⚠️ <b>No Vehicle Data</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          (details?.inventoryId ? `Inventory ID: <code>${details.inventoryId}</code>\n` : '') +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(noVehicleDataMessage);
        break;

      case 'no_browser':
        const noBrowserMessage = `🖥️ <b>Browser Unavailable</b>\n\n` +
          (component ? `Source: <code>${component}</code>\n` : '') +
          (vin ? `VIN: <code>${vin}</code>\n` : '') +
          `Chrome remote debugging is unreachable. Please ensure the browser is running.\n\n` +
          `Time: ${new Date().toISOString()}`;
        await telegramService.sendMessage(noBrowserMessage);
        break;

      case 'appraisal_failure_callback_email':
        if (!vin || !email || !errorType) {
          throw new Error('Missing required fields for appraisal_failure_callback_email alert');
        }
        const appraisalFailureMessage =
          `❌ <b>Appraisal Failure</b>\n\n` +
          `VIN: <code>${vin}</code>\n` +
          `Error Type: <code>${errorType}</code>\n` +
          `User Email: <code>${email}</code>\n` +
          `Time: ${timestamp ?? new Date().toISOString()}`;
        await telegramService.sendMessage(appraisalFailureMessage);
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

