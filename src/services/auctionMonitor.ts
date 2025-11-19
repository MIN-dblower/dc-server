import { DateTime } from 'luxon';
import {
  getActiveMonitoringWindows,
  MonitoringWindow,
  AuctionType,
  DEFAULT_TIME_ZONE,
} from './auctionSchedule';
import { findFileByName, listFilesInFolder } from './googledrive';
import { processAuctionFile } from './auctionFileProcessor';
import { processAdesaFile } from './adesaFileProcessor';

/**
 * Auction Monitor Service
 *
 * Monitors Google Drive folders for auction files based on schedule
 * and processes them according to business rules
 */

export interface AuctionMonitorConfig {
  adesaFolderId: string;
  edgeFolderId: string;
  pollIntervalMs?: number; // Default: 5 minutes
  cutoffTimeHours?: number; // Default: 12 (12 PM)
}

export class AuctionMonitor {
  private config: Required<AuctionMonitorConfig>;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: AuctionMonitorConfig) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 5 * 60 * 1000, // 5 minutes
      cutoffTimeHours: config.cutoffTimeHours ?? 12,
      adesaFolderId: config.adesaFolderId,
      edgeFolderId: config.edgeFolderId,
    };
  }

  /**
   * Checks if we should stop monitoring based on cutoff time (GMT-6)
   */
  private isPastCutoffTime(window: MonitoringWindow): boolean {
    const now = DateTime.now().setZone(DEFAULT_TIME_ZONE);
    const end = DateTime.fromJSDate(window.endDate, {
      zone: DEFAULT_TIME_ZONE,
    });
    return now > end;
  }

  /**
   * Gets the folder ID for an auction type
   */
  private getFolderId(auctionType: AuctionType): string {
    return auctionType === AuctionType.ADESA
      ? this.config.adesaFolderId
      : this.config.edgeFolderId;
  }

  /**
   * Processes a file for a monitoring window
   */
  private async processFileForWindow(window: MonitoringWindow): Promise<void> {
    // Check if past cutoff time
    if (this.isPastCutoffTime(window)) {
      console.log(
        `Monitoring window for ${window.auctionType} has passed cutoff time, stopping monitoring`,
      );
      return;
    }

    try {
      const folderId = this.getFolderId(window.auctionType);
      console.log(
        `Looking for file "${window.fileName}" in ${window.auctionType} folder (${folderId})`,
      );

      // Try exact match first
      let file = await findFileByName(folderId, window.fileName);

      // If not found, try pattern match (in case of slight naming variations)
      if (!file) {
        const pattern = new RegExp(
          window.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i',
        );
        file = await findFileByName(folderId, pattern);
      }

      if (!file) {
        console.log(
          `File "${window.fileName}" not found yet, will check again later`,
        );
        return;
      }

      console.log(`Found file: ${file.name} (ID: ${file.id})`);

      // Check if it's a Google Sheet
      const isGoogleSheet =
        file.mimeType === 'application/vnd.google-apps.spreadsheet';

      // Process the file
      if (!file.id || !file.name) {
        console.error(
          `File missing required properties: ${JSON.stringify(file)}`,
        );
        return;
      }
      console.log(`File: ${file.name} (ID: ${file.id})`);
      console.log(`Is Google Sheet: ${isGoogleSheet}`);
      // Use Adesa processor for Adesa files, regular processor for Edge
      if (window.auctionType === AuctionType.ADESA) {
        const result = await processAdesaFile(
          file.id,
          file.name,
          isGoogleSheet,
        );

        console.log(
          `✅ Successfully processed ${window.fileName}: ${result.newRecords.length} new, ${result.updatedRecords.length} updated`,
        );
        console.log(
          `   DC Queue: ${result.dcQueueStats.queued} enqueued, ${result.dcQueueStats.duplicates} duplicates, ${result.dcQueueStats.errors} errors`,
        );
      } else {
        // Edge Pipeline uses the regular processor
        const result = await processAuctionFile(
          file.id,
          file.name,
          isGoogleSheet,
        );

        console.log(
          `✅ Successfully processed ${window.fileName}: ${result.newRecords.length} new, ${result.updatedRecords.length} updated`,
        );
        console.log(
          `   DC Queue: ${result.dcQueueStats.queued} enqueued, ${result.dcQueueStats.duplicates} duplicates, ${result.dcQueueStats.errors} errors`,
        );
      }
    } catch (error) {
      console.error(`Error processing file for ${window.auctionType}:`, error);
      if (error instanceof Error) {
        console.error(error.message);
        if (error.stack) {
          console.error(error.stack);
        }
      }
    }
  }

  /**
   * Runs a single monitoring check
   */
  private async runMonitoringCheck(): Promise<void> {
    const now = DateTime.now().setZone(DEFAULT_TIME_ZONE);
    console.log(
      `\n🔍 Running monitoring check at ${now.toISO()} (${DEFAULT_TIME_ZONE})`,
    );

    const activeWindows = getActiveMonitoringWindows(now.toJSDate());

    if (activeWindows.length === 0) {
      console.log('No active monitoring windows at this time');
      return;
    }

    console.log(`Found ${activeWindows.length} active monitoring window(s)`);

    for (const window of activeWindows) {
      console.log(
        `\n📅 Monitoring ${window.auctionType.toUpperCase()} auction:`,
      );
      console.log(`   File: ${window.fileName}`);
      console.log(
        `   Window: ${window.startDate.toISOString()} to ${window.endDate.toISOString()}`,
      );

      await this.processFileForWindow(window);
    }
  }

  /**
   * Starts the monitoring service
   */
  public start(): void {
    console.log('🚀 Starting Auction Monitor Service');
    console.log(`   Poll interval: ${this.config.pollIntervalMs / 1000}s`);
    console.log(`   Adesa folder ID: ${this.config.adesaFolderId}`);
    console.log(`   Edge folder ID: ${this.config.edgeFolderId}`);

    // Run initial check
    this.runMonitoringCheck().catch(error => {
      console.error('Error in initial monitoring check:', error);
    });

    // Schedule periodic checks
    this.monitoringInterval = setInterval(() => {
      this.runMonitoringCheck().catch(error => {
        console.error('Error in monitoring check:', error);
      });
    }, this.config.pollIntervalMs);
  }

  /**
   * Stops the monitoring service
   */
  public stop(): void {
    console.log('🛑 Stopping Auction Monitor Service');

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Manually triggers a monitoring check
   */
  public async checkNow(): Promise<void> {
    await this.runMonitoringCheck();
  }
}
