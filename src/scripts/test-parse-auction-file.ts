#!/usr/bin/env ts-node

/**
 * Test script to parse auction records from a Google Drive file
 * 
 * Usage:
 *   ts-node src/scripts/test-parse-auction-file.ts <fileId> [auctionType]
 * 
 * Examples:
 *   ts-node src/scripts/test-parse-auction-file.ts 1abc123def456
 *   ts-node src/scripts/test-parse-auction-file.ts 1abc123def456 adesa
 *   ts-node src/scripts/test-parse-auction-file.ts 1abc123def456 edge
 */

import * as dotenv from 'dotenv';
import { readGoogleSheetAsCSV, downloadFile, getFileInfo } from '../services/googledrive';
import { parseAdesaCSV } from '../utils/adesaCsvParser';
import { parseCSV } from '../utils/csvParser';
import { AdesaRecord } from '../interfaces/adesa.types';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';

dotenv.config();

type AuctionType = 'adesa' | 'edge' | 'auto';

interface TestResult {
  success: boolean;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  errors: string[];
  sampleRecords: (AdesaRecord | EdgePipelineRecord)[];
  fileInfo: {
    name: string;
    mimeType: string;
    isGoogleSheet: boolean;
  };
}

/**
 * Validates an Adesa record
 */
function validateAdesaRecord(record: AdesaRecord, index: number): string[] {
  const errors: string[] = [];

  if (!record.vin || record.vin.trim() === '') {
    errors.push(`Record ${index}: Missing VIN`);
  }

  if (!record.year || record.year < 1900 || record.year > new Date().getFullYear() + 1) {
    errors.push(`Record ${index} (VIN: ${record.vin}): Invalid year: ${record.year}`);
  }

  if (!record.make || record.make.trim() === '') {
    errors.push(`Record ${index} (VIN: ${record.vin}): Missing make`);
  }

  if (!record.model || record.model.trim() === '') {
    errors.push(`Record ${index} (VIN: ${record.vin}): Missing model`);
  }

  if (record.odometer < 0) {
    errors.push(`Record ${index} (VIN: ${record.vin}): Invalid odometer: ${record.odometer}`);
  }

  return errors;
}

/**
 * Validates an Edge Pipeline record
 */
function validateEdgeRecord(record: EdgePipelineRecord, index: number): string[] {
  const errors: string[] = [];

  if (!record.vin || record.vin.trim() === '') {
    errors.push(`Record ${index}: Missing VIN`);
  }

  if (!record.year || record.year < 1900 || record.year > new Date().getFullYear() + 1) {
    errors.push(`Record ${index} (VIN: ${record.vin}): Invalid year: ${record.year}`);
  }

  if (!record.make || record.make.trim() === '') {
    errors.push(`Record ${index} (VIN: ${record.vin}): Missing make`);
  }

  if (!record.model || record.model.trim() === '') {
    errors.push(`Record ${index} (VIN: ${record.vin}): Missing model`);
  }

  if (record.odometer < 0) {
    errors.push(`Record ${index} (VIN: ${record.vin}): Invalid odometer: ${record.odometer}`);
  }

  return errors;
}

/**
 * Detects auction type from filename
 */
function detectAuctionType(fileName: string): 'adesa' | 'edge' {
  const lowerName = fileName.toLowerCase();
  if (lowerName.includes('adesa')) {
    return 'adesa';
  }
  if (lowerName.includes('americas') || lowerName.includes('edge')) {
    return 'edge';
  }
  // Default to edge if uncertain
  return 'edge';
}

/**
 * Tests parsing an Adesa file
 */
async function testAdesaFile(fileId: string, isGoogleSheet: boolean): Promise<TestResult> {
  const fileInfo = await getFileInfo(fileId);
  const errors: string[] = [];
  let records: AdesaRecord[] = [];

  try {
    // Get file content
    let csvContent: string;
    if (isGoogleSheet) {
      csvContent = await readGoogleSheetAsCSV(fileId);
    } else {
      const buffer = await downloadFile(fileId);
      csvContent = buffer.toString('utf-8');
    }

    // Parse CSV
    records = parseAdesaCSV(csvContent);

    // Validate records
    records.forEach((record, index) => {
      const recordErrors = validateAdesaRecord(record, index);
      errors.push(...recordErrors);
    });
  } catch (error) {
    errors.push(`Failed to parse file: ${error instanceof Error ? error.message : String(error)}`);
  }

  const validRecords = records.filter(r => r.vin && r.vin.trim() !== '');
  const invalidRecords = records.length - validRecords.length;

  return {
    success: errors.length === 0 && records.length > 0,
    totalRecords: records.length,
    validRecords: validRecords.length,
    invalidRecords,
    errors,
    sampleRecords: records.slice(0, 5),
    fileInfo: {
      name: fileInfo.name || 'Unknown',
      mimeType: fileInfo.mimeType || 'Unknown',
      isGoogleSheet,
    },
  };
}

/**
 * Tests parsing an Edge Pipeline file
 */
async function testEdgeFile(fileId: string, isGoogleSheet: boolean): Promise<TestResult> {
  const fileInfo = await getFileInfo(fileId);
  const errors: string[] = [];
  let records: EdgePipelineRecord[] = [];

  try {
    // Get file content
    let csvContent: string;
    if (isGoogleSheet) {
      csvContent = await readGoogleSheetAsCSV(fileId);
    } else {
      const buffer = await downloadFile(fileId);
      csvContent = buffer.toString('utf-8');
    }

    // Parse CSV
    records = parseCSV(csvContent);

    // Validate records
    records.forEach((record, index) => {
      const recordErrors = validateEdgeRecord(record, index);
      errors.push(...recordErrors);
    });
  } catch (error) {
    errors.push(`Failed to parse file: ${error instanceof Error ? error.message : String(error)}`);
  }

  const validRecords = records.filter(r => r.vin && r.vin.trim() !== '');
  const invalidRecords = records.length - validRecords.length;

  return {
    success: errors.length === 0 && records.length > 0,
    totalRecords: records.length,
    validRecords: validRecords.length,
    invalidRecords,
    errors,
    sampleRecords: records.slice(0, 5),
    fileInfo: {
      name: fileInfo.name || 'Unknown',
      mimeType: fileInfo.mimeType || 'Unknown',
      isGoogleSheet,
    },
  };
}

/**
 * Main test function
 */
async function testParseAuctionFile(
  fileId: string,
  auctionType: AuctionType = 'auto'
): Promise<void> {
  console.log('🧪 Testing Auction File Parsing\n');
  console.log(`File ID: ${fileId}`);
  console.log(`Auction Type: ${auctionType}\n`);

  try {
    // Get file info
    const fileInfo = await getFileInfo(fileId);
    const isGoogleSheet =
      fileInfo.mimeType === 'application/vnd.google-apps.spreadsheet';

    console.log(`File Name: ${fileInfo.name}`);
    console.log(`MIME Type: ${fileInfo.mimeType}`);
    console.log(`Is Google Sheet: ${isGoogleSheet}\n`);

    // Determine auction type
    let detectedType: 'adesa' | 'edge' = auctionType === 'auto' 
      ? detectAuctionType(fileInfo.name || '')
      : auctionType as 'adesa' | 'edge';

    if (auctionType === 'auto') {
      console.log(`Auto-detected auction type: ${detectedType}\n`);
    }

    // Run test
    const result = detectedType === 'adesa'
      ? await testAdesaFile(fileId, isGoogleSheet)
      : await testEdgeFile(fileId, isGoogleSheet);

    // Print results
    console.log('='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Total Records: ${result.totalRecords}`);
    console.log(`Valid Records: ${result.validRecords}`);
    console.log(`Invalid Records: ${result.invalidRecords}`);
    console.log(`Errors: ${result.errors.length}\n`);

    if (result.errors.length > 0) {
      console.log('Errors:');
      result.errors.slice(0, 20).forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
      if (result.errors.length > 20) {
        console.log(`  ... and ${result.errors.length - 20} more errors`);
      }
      console.log();
    }

    if (result.sampleRecords.length > 0) {
      console.log('Sample Records (first 5):');
      result.sampleRecords.forEach((record, index) => {
        console.log(`\n  Record ${index + 1}:`);
        if (detectedType === 'adesa') {
          const r = record as AdesaRecord;
          console.log(`    VIN: ${r.vin}`);
          console.log(`    Year/Make/Model: ${r.year} ${r.make} ${r.model}`);
          console.log(`    Odometer: ${r.odometer}`);
          console.log(`    Location: ${r.location}`);
          console.log(`    Notes: ${r.notes?.substring(0, 50)}${r.notes && r.notes.length > 50 ? '...' : ''}`);
        } else {
          const r = record as EdgePipelineRecord;
          console.log(`    VIN: ${r.vin}`);
          console.log(`    Year/Make/Model: ${r.year} ${r.make} ${r.model}`);
          console.log(`    Odometer: ${r.odometer}`);
          console.log(`    Auction: ${r.auctionName}`);
          console.log(`    Watch Notes: ${r.watchNotes?.substring(0, 50)}${r.watchNotes && r.watchNotes.length > 50 ? '...' : ''}`);
        }
      });
      console.log();
    }

    // Summary
    console.log('='.repeat(60));
    if (result.success) {
      console.log('✅ Test PASSED: File parsed successfully with valid records');
    } else {
      console.log('❌ Test FAILED: Issues found during parsing');
    }
    console.log('='.repeat(60));

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('❌ Test FAILED with error:');
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: ts-node src/scripts/test-parse-auction-file.ts <fileId> [auctionType]');
  console.error('');
  console.error('Arguments:');
  console.error('  fileId      - Google Drive file ID (required)');
  console.error('  auctionType - "adesa", "edge", or "auto" (default: "auto")');
  console.error('');
  console.error('Examples:');
  console.error('  ts-node src/scripts/test-parse-auction-file.ts 1abc123def456');
  console.error('  ts-node src/scripts/test-parse-auction-file.ts 1abc123def456 adesa');
  console.error('  ts-node src/scripts/test-parse-auction-file.ts 1abc123def456 edge');
  process.exit(1);
}

const fileId = args[0];
const auctionType = (args[1] as AuctionType) || 'auto';

if (!['adesa', 'edge', 'auto'].includes(auctionType)) {
  console.error(`Invalid auction type: ${auctionType}. Must be "adesa", "edge", or "auto"`);
  process.exit(1);
}

testParseAuctionFile(fileId, auctionType).catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

