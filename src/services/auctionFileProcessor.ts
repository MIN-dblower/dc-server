import { parseCSV } from '../utils/csvParser';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';
import { loadRecordMap, saveOrUpdateRecord } from '../storage/db';
import * as fs from 'fs';
import { readGoogleSheetAsCSV, downloadFile } from './googledrive';
import { enqueueDCUpdateJob } from './jobQueue';

/**
 * Processes Edge Pipeline auction files and handles VIN deduplication
 * Updates DC before saving to database (only for odometer/watchNotes changes)
 */

export interface ProcessedFileResult {
  newRecords: EdgePipelineRecord[];
  updatedRecords: EdgePipelineRecord[];
  skippedRecords: EdgePipelineRecord[];
  totalRecords: number;
  dcQueueStats: {
    queued: number;
    duplicates: number;
    errors: number;
  };
}

/**
 * Parses a CSV file and returns auction records
 */
async function parseFileContent(filePath: string, fileContent?: string): Promise<EdgePipelineRecord[]> {
  let content: string;
  
  if (fileContent) {
    content = fileContent;
  } else {
    content = fs.readFileSync(filePath, 'utf-8');
  }
  
  return parseCSV(content);
}

/**
 * Detects changes between existing records and new records
 * Returns records with information about what changed
 */
function detectChanges(
  existingRecords: Record<string, EdgePipelineRecord>,
  newRecords: EdgePipelineRecord[]
): {
  newRecords: EdgePipelineRecord[];
  updatedRecords: EdgePipelineRecord[];
  recordsNeedingDCUpdate: EdgePipelineRecord[]; // Records where odometer or watchNotes changed
  recordsNeedingDBOnly: EdgePipelineRecord[]; // Records with other changes (not odometer/watchNotes)
  skippedRecords: EdgePipelineRecord[];
} {
  const newRecordsList: EdgePipelineRecord[] = [];
  const updatedRecordsList: EdgePipelineRecord[] = [];
  const recordsNeedingDCUpdate: EdgePipelineRecord[] = [];
  const recordsNeedingDBOnly: EdgePipelineRecord[] = [];
  const skippedRecordsList: EdgePipelineRecord[] = [];

  for (const newRecord of newRecords) {
    if (!newRecord.vin || newRecord.vin.trim() === '') {
      console.warn(`Skipping record without VIN: ${JSON.stringify(newRecord)}`);
      skippedRecordsList.push(newRecord);
      continue;
    }

    const existingRecord = existingRecords[newRecord.vin];

    if (!existingRecord) {
      // New VIN - import all data, needs DC update (new vehicle)
      newRecordsList.push(newRecord);
      recordsNeedingDCUpdate.push(newRecord);
    } else {
      // Existing VIN - check if data has changed
      const odometerChanged = existingRecord.odometer !== newRecord.odometer;
      const watchNotesChanged = existingRecord.watchNotes !== newRecord.watchNotes;
      
      // Check if any other fields changed
      const otherFieldsChanged =
        existingRecord.auctionName !== newRecord.auctionName ||
        existingRecord.pictureCount !== newRecord.pictureCount ||
        existingRecord.runNumber !== newRecord.runNumber ||
        existingRecord.stockNumber !== newRecord.stockNumber ||
        existingRecord.year !== newRecord.year ||
        existingRecord.make !== newRecord.make ||
        existingRecord.model !== newRecord.model ||
        existingRecord.style !== newRecord.style ||
        existingRecord.color !== newRecord.color ||
        existingRecord.cr !== newRecord.cr ||
        existingRecord.grade !== newRecord.grade ||
        existingRecord.saleDate !== newRecord.saleDate ||
        existingRecord.lane !== newRecord.lane ||
        existingRecord.soldAmount !== newRecord.soldAmount;

      if (odometerChanged || watchNotesChanged) {
        // Odometer or watchNotes changed - needs DC update AND DB save
        updatedRecordsList.push(newRecord);
        recordsNeedingDCUpdate.push(newRecord);
      } else if (otherFieldsChanged) {
        // Other fields changed but not odometer/watchNotes - only DB save
        updatedRecordsList.push(newRecord);
        recordsNeedingDBOnly.push(newRecord);
      } else {
        // No changes - skip
        skippedRecordsList.push(newRecord);
      }
    }
  }

  return {
    newRecords: newRecordsList,
    updatedRecords: updatedRecordsList,
    recordsNeedingDCUpdate,
    recordsNeedingDBOnly,
    skippedRecords: skippedRecordsList,
  };
}

/**
 * Processes a CSV file from Google Drive
 * Handles both regular CSV files and Google Sheets
 */
export async function processAuctionFile(
  fileId: string,
  fileName: string,
  isGoogleSheet: boolean = false
): Promise<ProcessedFileResult> {
  console.log(`Processing file: ${fileName} (ID: ${fileId})`);
  
  // Load existing records from database
  const existingRecords = await loadRecordMap();
  console.log(`Loaded ${Object.keys(existingRecords).length} existing records from database`);

  // Get file content
  let records: EdgePipelineRecord[];
  
  if (isGoogleSheet) {
    // Read Google Sheet using Sheets API and convert to CSV
    const csvContent = await readGoogleSheetAsCSV(fileId);
    records = parseCSV(csvContent);
  } else {
    // Download and parse CSV file
    const buffer = await downloadFile(fileId);
    const csvContent = buffer.toString('utf-8');
    records = parseCSV(csvContent);
  }

  console.log(`Parsed ${records.length} records from file`);

  // Detect changes
  const {
    newRecords,
    updatedRecords,
    recordsNeedingDCUpdate,
    recordsNeedingDBOnly,
    skippedRecords,
  } = detectChanges(existingRecords, records);

  console.log(`Results:
    - New records: ${newRecords.length}
    - Updated records (odometer/watchNotes changed): ${recordsNeedingDCUpdate.length}
    - Updated records (other fields changed): ${recordsNeedingDBOnly.length}
    - Skipped records: ${skippedRecords.length}`);

  // Enqueue DC jobs only for records where odometer or watchNotes changed
  let dcJobsQueued = 0;
  let dcJobsDuplicate = 0;
  let dcJobsErrored = 0;

  // Process records that need DC update (new records or odometer/watchNotes changed)
  for (const record of recordsNeedingDCUpdate) {
    const isNew = !existingRecords[record.vin];

    try {
      const { wasDuplicate } = await enqueueDCUpdateJob({
        record,
        isNewRecord: isNew,
        auctionType: 'Edge Pipeline',
        fileId,
        fileName,
      });

      if (wasDuplicate) {
        dcJobsDuplicate++;
      } else {
        dcJobsQueued++;
      }
    } catch (error) {
      dcJobsErrored++;
      console.error(
        `Error enqueueing DC job for VIN ${record.vin}:`,
        error,
      );
    }
  }

  // Save records that only need DB update (other fields changed, not odometer/watchNotes)
  for (const record of recordsNeedingDBOnly) {
    try {
      await saveOrUpdateRecord(record);
    } catch (error) {
      console.error(`Error saving record to DB for VIN ${record.vin}:`, error);
    }
  }

  return {
    newRecords,
    updatedRecords,
    skippedRecords,
    totalRecords: records.length,
    dcQueueStats: {
      queued: dcJobsQueued,
      duplicates: dcJobsDuplicate,
      errors: dcJobsErrored,
    },
  };
}

/**
 * Processes an auction CSV string (e.g. from an uploaded file)
 */
export async function processAuctionCSVContent(
  csvContent: string,
  fileName: string,
  sourceId: string = 'upload',
): Promise<ProcessedFileResult> {
  console.log(
    `Processing uploaded Edge Pipeline CSV: ${fileName} (source: ${sourceId})`,
  );

  // Load existing records from database
  const existingRecords = await loadRecordMap();
  console.log(
    `Loaded ${Object.keys(existingRecords).length} existing records from database`,
  );

  // Parse CSV content
  const records = parseCSV(csvContent);
  console.log(`Parsed ${records.length} records from uploaded file`);

  // Detect changes
  const {
    newRecords,
    updatedRecords,
    recordsNeedingDCUpdate,
    recordsNeedingDBOnly,
    skippedRecords,
  } = detectChanges(existingRecords, records);

  console.log(`Results:
    - New records: ${newRecords.length}
    - Updated records (odometer/watchNotes changed): ${recordsNeedingDCUpdate.length}
    - Updated records (other fields changed): ${recordsNeedingDBOnly.length}
    - Skipped records: ${skippedRecords.length}`);

  // Enqueue DC jobs only for records where odometer or watchNotes changed
  let dcJobsQueued = 0;
  let dcJobsDuplicate = 0;
  let dcJobsErrored = 0;

  // Process records that need DC update (new records or odometer/watchNotes changed)
  for (const record of recordsNeedingDCUpdate) {
    const isNew = !existingRecords[record.vin];

    try {
      const { wasDuplicate } = await enqueueDCUpdateJob({
        record,
        isNewRecord: isNew,
        auctionType: 'Edge Pipeline',
        fileId: sourceId,
        fileName,
      });

      if (wasDuplicate) {
        dcJobsDuplicate++;
      } else {
        dcJobsQueued++;
      }
    } catch (error) {
      dcJobsErrored++;
      console.error(
        `Error enqueueing DC job for VIN ${record.vin}:`,
        error,
      );
    }
  }

  // Save records that only need DB update (other fields changed, not odometer/watchNotes)
  for (const record of recordsNeedingDBOnly) {
    try {
      await saveOrUpdateRecord(record);
    } catch (error) {
      console.error(
        `Error saving record to DB for VIN ${record.vin}:`,
        error,
      );
    }
  }

  return {
    newRecords,
    updatedRecords,
    skippedRecords,
    totalRecords: records.length,
    dcQueueStats: {
      queued: dcJobsQueued,
      duplicates: dcJobsDuplicate,
      errors: dcJobsErrored,
    },
  };
}

/**
 * Processes a local CSV file
 */
export async function processLocalAuctionFile(filePath: string): Promise<ProcessedFileResult> {
  console.log(`Processing local file: ${filePath}`);
  
  // Load existing records from database
  const existingRecords = await loadRecordMap();
  console.log(`Loaded ${Object.keys(existingRecords).length} existing records from database`);

  // Parse file
  const records = await parseFileContent(filePath);
  console.log(`Parsed ${records.length} records from file`);

  // Detect changes
  const {
    newRecords,
    updatedRecords,
    recordsNeedingDCUpdate,
    recordsNeedingDBOnly,
    skippedRecords,
  } = detectChanges(existingRecords, records);

  console.log(`Results:
    - New records: ${newRecords.length}
    - Updated records (odometer/watchNotes changed): ${recordsNeedingDCUpdate.length}
    - Updated records (other fields changed): ${recordsNeedingDBOnly.length}
    - Skipped records: ${skippedRecords.length}`);

  // Enqueue DC jobs only for records where odometer or watchNotes changed
  let dcJobsQueued = 0;
  let dcJobsDuplicate = 0;
  let dcJobsErrored = 0;

  // Process records that need DC update (new records or odometer/watchNotes changed)
  for (const record of recordsNeedingDCUpdate) {
    const isNew = !existingRecords[record.vin];

    try {
      const { wasDuplicate } = await enqueueDCUpdateJob({
        record,
        isNewRecord: isNew,
        auctionType: 'Edge Pipeline',
        fileId: 'local-file',
        fileName: filePath,
      });

      if (wasDuplicate) {
        dcJobsDuplicate++;
      } else {
        dcJobsQueued++;
      }
    } catch (error) {
      dcJobsErrored++;
      console.error(
        `Error enqueueing DC job for VIN ${record.vin}:`,
        error,
      );
    }
  }

  // Save records that only need DB update (other fields changed, not odometer/watchNotes)
  for (const record of recordsNeedingDBOnly) {
    try {
      await saveOrUpdateRecord(record);
    } catch (error) {
      console.error(`Error saving record to DB for VIN ${record.vin}:`, error);
    }
  }

  return {
    newRecords,
    updatedRecords,
    skippedRecords,
    totalRecords: records.length,
    dcQueueStats: {
      queued: dcJobsQueued,
      duplicates: dcJobsDuplicate,
      errors: dcJobsErrored,
    },
  };
}

