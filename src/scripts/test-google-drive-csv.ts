import {
  listFilesInFolder,
  findFileByName,
  downloadFile,
  readGoogleSheetAsCSV,
} from '../services/googledrive';
import { parseCSV } from '../utils/csvParser';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';

/**
 * Test script to verify Google Drive CSV file reading
 * Tests both Adesa and Edge Pipeline folders
 */

function getEnvVar(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Tests reading and parsing a CSV file from Google Drive
 */
async function testFileReading(
  folderId: string,
  folderName: string,
  fileName?: string,
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${folderName} folder (ID: ${folderId})`);
  console.log('='.repeat(60));

  try {
    // List all files in the folder
    console.log('\n📁 Listing files in folder...');
    const files = await listFilesInFolder(folderId);

    if (files.length === 0) {
      console.log('⚠️  No files found in this folder');
      return;
    }

    console.log(`✅ Found ${files.length} file(s):`);
    files.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file.name} (${file.mimeType})`);
    });

    // If a specific file name is provided, test that file
    // Otherwise, test the first CSV file found
    let testFile = fileName
      ? await findFileByName(folderId, fileName)
      : files.find(
          f =>
            (f && f.name && f.name.toLowerCase().endsWith('.csv')) ||
            f.mimeType === 'application/vnd.google-apps.spreadsheet' ||
            f.mimeType === 'text/csv',
        );

    if (!testFile) {
      console.log('\n⚠️  No CSV file found to test');
      return;
    }

    console.log(`\n📄 Testing file: ${testFile.name}`);
    console.log(`   File ID: ${testFile.id}`);
    console.log(`   MIME Type: ${testFile.mimeType}`);

    // Determine if it's a Google Sheet or regular CSV
    const isGoogleSheet =
      testFile.mimeType === 'application/vnd.google-apps.spreadsheet';

    let csvContent: string;
    let records: EdgePipelineRecord[];

    if (isGoogleSheet) {
      console.log('\n📊 Reading Google Sheet using Sheets API...');
      csvContent = await readGoogleSheetAsCSV(testFile.id!);
      console.log(
        `✅ Retrieved ${csvContent.length} characters from Google Sheet`,
      );
    } else {
      console.log('\n📥 Downloading CSV file...');
      const buffer = await downloadFile(testFile.id!);
      csvContent = buffer.toString('utf-8');
      console.log(`✅ Downloaded ${csvContent.length} characters`);
    }

    // Parse the CSV
    console.log('\n🔍 Parsing CSV content...');
    records = parseCSV(csvContent);
    console.log(`✅ Parsed ${records.length} record(s)`);

    // Display sample records
    if (records.length > 0) {
      console.log('\n📋 Sample records (first 3):');
      records.slice(0, 3).forEach((record, index) => {
        console.log(`\n   Record ${index + 1}:`);
        console.log(`     VIN: ${record.vin || '(empty)'}`);
        console.log(`     Year: ${record.year || '(empty)'}`);
        console.log(`     Make: ${record.make || '(empty)'}`);
        console.log(`     Model: ${record.model || '(empty)'}`);
        console.log(`     Odometer: ${record.odometer || '(empty)'}`);
        console.log(`     Stock Number: ${record.stockNumber || '(empty)'}`);
        console.log(`     Run Number: ${record.runNumber || '(empty)'}`);
        console.log(`     Auction Name: ${record.auctionName || '(empty)'}`);
      });

      // Validate records
      console.log('\n✅ Validation:');
      const recordsWithVIN = records.filter(r => r.vin && r.vin.trim() !== '');
      const recordsWithoutVIN = records.length - recordsWithVIN.length;

      console.log(`   Total records: ${records.length}`);
      console.log(`   Records with VIN: ${recordsWithVIN.length}`);
      if (recordsWithoutVIN > 0) {
        console.log(`   ⚠️  Records without VIN: ${recordsWithoutVIN}`);
      }

      // Check for duplicate VINs in the file
      const vinSet = new Set<string>();
      const duplicateVINs: string[] = [];
      recordsWithVIN.forEach(record => {
        if (vinSet.has(record.vin)) {
          duplicateVINs.push(record.vin);
        } else {
          vinSet.add(record.vin);
        }
      });

      if (duplicateVINs.length > 0) {
        console.log(`   ⚠️  Duplicate VINs in file: ${duplicateVINs.length}`);
        console.log(
          `   Example duplicates: ${duplicateVINs.slice(0, 5).join(', ')}`,
        );
      } else {
        console.log(`   ✅ No duplicate VINs in file`);
      }
    } else {
      console.log('\n⚠️  No records found in CSV file');
    }

    console.log(`\n✅ ${folderName} test completed successfully!`);
  } catch (error) {
    console.error(`\n❌ Error testing ${folderName} folder:`, error);
    if (error instanceof Error) {
      console.error(`   Error message: ${error.message}`);
      if (error.stack) {
        console.error(`   Stack trace:\n${error.stack}`);
      }
    }
    throw error;
  }
}

/**
 * Main test function
 */
async function main(): Promise<void> {
  console.log('🧪 Google Drive CSV Reading Test Script');
  console.log('========================================\n');

  try {
    // Get folder IDs from environment
    const adesaFolderId = getEnvVar('GOOGLE_DRIVE_ADESA_FOLDER_ID');
    const edgeFolderId = getEnvVar('GOOGLE_DRIVE_EDGE_FOLDER_ID');

    console.log('Configuration:');
    console.log(`  Adesa Folder ID: ${adesaFolderId}`);
    console.log(`  Edge Pipeline Folder ID: ${edgeFolderId}`);

    // Test Adesa folder
    await testFileReading(adesaFolderId, 'Adesa');

    // Test Edge Pipeline folder
    await testFileReading(edgeFolderId, 'Edge Pipeline');

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
