import { parseAdesaCSV } from '../utils/adesaCsvParser';
import { AdesaRecord } from '../interfaces/adesa.types';
import { loadAdesaRecordMap, saveOrUpdateAdesaRecord } from '../storage/adesaDb';
import { readGoogleSheetAsCSV, downloadFile } from './googledrive';
import { updateVehicleInDC } from './dcUpdateInterface';

/**
 * Processes Adesa auction files and handles VIN deduplication
 * Updates DC before saving to database
 */

export interface ProcessedAdesaFileResult {
  newRecords: AdesaRecord[];
  updatedRecords: AdesaRecord[];
  skippedRecords: AdesaRecord[];
  totalRecords: number;
  dcUpdateResults: {
    successful: number;
    failed: number;
  };
}

/**
 * Detects changes between existing records and new records
 * Returns records with information about what changed
 */
function detectChanges(
  existingRecords: Record<string, AdesaRecord>,
  newRecords: AdesaRecord[]
): {
  newRecords: AdesaRecord[];
  updatedRecords: AdesaRecord[];
  recordsNeedingDCUpdate: AdesaRecord[]; // Records where odometer or notes changed
  recordsNeedingDBOnly: AdesaRecord[]; // Records with other changes (not odometer/notes)
  skippedRecords: AdesaRecord[];
} {
  const newRecordsList: AdesaRecord[] = [];
  const updatedRecordsList: AdesaRecord[] = [];
  const recordsNeedingDCUpdate: AdesaRecord[] = [];
  const recordsNeedingDBOnly: AdesaRecord[] = [];
  const skippedRecordsList: AdesaRecord[] = [];

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
      const notesChanged = existingRecord.notes !== newRecord.notes;
      
      // Check if any other fields changed
      const otherFieldsChanged =
        existingRecord.laneRun !== newRecord.laneRun ||
        existingRecord.date !== newRecord.date ||
        existingRecord.saleChannel !== newRecord.saleChannel ||
        existingRecord.location !== newRecord.location ||
        existingRecord.year !== newRecord.year ||
        existingRecord.make !== newRecord.make ||
        existingRecord.model !== newRecord.model ||
        existingRecord.trim !== newRecord.trim ||
        existingRecord.engine !== newRecord.engine ||
        existingRecord.transmission !== newRecord.transmission ||
        existingRecord.drivetrain !== newRecord.drivetrain ||
        existingRecord.fuel !== newRecord.fuel ||
        existingRecord.exteriorColor !== newRecord.exteriorColor ||
        existingRecord.grade !== newRecord.grade ||
        existingRecord.conditionGuarantee !== newRecord.conditionGuarantee ||
        existingRecord.driveability !== newRecord.driveability ||
        existingRecord.carValue !== newRecord.carValue ||
        existingRecord.seller !== newRecord.seller ||
        existingRecord.announcements !== newRecord.announcements ||
        existingRecord.titleStatus !== newRecord.titleStatus;

      if (odometerChanged || notesChanged) {
        // Odometer or notes changed - needs DC update AND DB save
        updatedRecordsList.push(newRecord);
        recordsNeedingDCUpdate.push(newRecord);
      } else if (otherFieldsChanged) {
        // Other fields changed but not odometer/notes - only DB save
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
 * Processes an Adesa CSV file from Google Drive
 * Handles both regular CSV files and Google Sheets
 * Updates DC before saving to database
 */
export async function processAdesaFile(
  fileId: string,
  fileName: string,
  isGoogleSheet: boolean = false
): Promise<ProcessedAdesaFileResult> {
  console.log(`Processing Adesa file: ${fileName} (ID: ${fileId})`);

  // Load existing records from database
  const existingRecords = await loadAdesaRecordMap();
  console.log(
    `Loaded ${Object.keys(existingRecords).length} existing Adesa records from database`
  );

  // Get file content
  let records: AdesaRecord[];

  if (isGoogleSheet) {
    // Read Google Sheet using Sheets API and convert to CSV
    const csvContent = await readGoogleSheetAsCSV(fileId);
    records = parseAdesaCSV(csvContent);
  } else {
    // Download and parse CSV file
    const buffer = await downloadFile(fileId);
    const csvContent = buffer.toString('utf-8');
    records = parseAdesaCSV(csvContent);
  }

  console.log(`Parsed ${records.length} Adesa records from file`);

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
    - Updated records (odometer/notes changed): ${recordsNeedingDCUpdate.length}
    - Updated records (other fields changed): ${recordsNeedingDBOnly.length}
    - Skipped records: ${skippedRecords.length}`);

  // Update DC only for records where odometer or notes changed
  let dcSuccessful = 0;
  let dcFailed = 0;

  // Process records that need DC update (new records or odometer/notes changed)
  for (const record of recordsNeedingDCUpdate) {
    const isNew = newRecords.includes(record);

    try {
      // Update DC first
      const dcResult = await updateVehicleInDC(record, isNew);

      if (dcResult.success) {
        dcSuccessful++;
        // Save to database after successful DC update
        await saveOrUpdateAdesaRecord(record);
      } else {
        dcFailed++;
        console.error(
          `Skipping database save for VIN ${record.vin} due to DC update failure`
        );
      }
    } catch (error) {
      dcFailed++;
      console.error(`Error processing record for VIN ${record.vin}:`, error);
    }
  }

  // Save records that only need DB update (other fields changed, not odometer/notes)
  for (const record of recordsNeedingDBOnly) {
    try {
      await saveOrUpdateAdesaRecord(record);
    } catch (error) {
      console.error(`Error saving record to DB for VIN ${record.vin}:`, error);
    }
  }

  return {
    newRecords,
    updatedRecords,
    skippedRecords,
    totalRecords: records.length,
    dcUpdateResults: {
      successful: dcSuccessful,
      failed: dcFailed,
    },
  };
}

/**
 * Processes a local Adesa CSV file
 */
export async function processLocalAdesaFile(
  filePath: string
): Promise<ProcessedAdesaFileResult> {
  console.log(`Processing local Adesa file: ${filePath}`);

  // Load existing records from database
  const existingRecords = await loadAdesaRecordMap();
  console.log(
    `Loaded ${Object.keys(existingRecords).length} existing Adesa records from database`
  );

  // Parse file
  const fs = require('fs');
  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const records = parseAdesaCSV(csvContent);
  console.log(`Parsed ${records.length} Adesa records from file`);

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
    - Updated records (odometer/notes changed): ${recordsNeedingDCUpdate.length}
    - Updated records (other fields changed): ${recordsNeedingDBOnly.length}
    - Skipped records: ${skippedRecords.length}`);

  // Update DC only for records where odometer or notes changed
  let dcSuccessful = 0;
  let dcFailed = 0;

  // Process records that need DC update (new records or odometer/notes changed)
  for (const record of recordsNeedingDCUpdate) {
    const isNew = newRecords.includes(record);

    try {
      // Update DC first
      const dcResult = await updateVehicleInDC(record, isNew);

      if (dcResult.success) {
        dcSuccessful++;
        // Save to database after successful DC update
        await saveOrUpdateAdesaRecord(record);
      } else {
        dcFailed++;
        console.error(
          `Skipping database save for VIN ${record.vin} due to DC update failure`
        );
      }
    } catch (error) {
      dcFailed++;
      console.error(`Error processing record for VIN ${record.vin}:`, error);
    }
  }

  // Save records that only need DB update (other fields changed, not odometer/notes)
  for (const record of recordsNeedingDBOnly) {
    try {
      await saveOrUpdateAdesaRecord(record);
    } catch (error) {
      console.error(`Error saving record to DB for VIN ${record.vin}:`, error);
    }
  }

  return {
    newRecords,
    updatedRecords,
    skippedRecords,
    totalRecords: records.length,
    dcUpdateResults: {
      successful: dcSuccessful,
      failed: dcFailed,
    },
  };
}


