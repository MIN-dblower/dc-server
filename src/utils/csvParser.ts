import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';

/**
 * Parses a CSV row handling quoted fields properly
 */
function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    const nextChar = row[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Add last field
  result.push(current);

  return result;
}

/**
 * Parses Edge Pipeline CSV format
 * Expected columns: Auction Name, Picture Count, Run Number, Stock #, Year, Make, Model, Style, Color, Odometer, CR, Grade, Sale Date, Lane, VIN, Sold Amount, Watch Notes
 */
export function parseCSV(csv: string): EdgePipelineRecord[] {
  const lines = csv.trim().split('\n');
  
  if (lines.length < 2) {
    return [];
  }

  // Skip header row
  const [, ...rows] = lines;

  return rows
    .map(row => {
      const col = parseCSVRow(row);
      
      // Pad missing columns with empty strings (we need 17 columns total: 0-16)
      if (col.length < 17) {
        const missingColumns = 17 - col.length;
        for (let i = 0; i < missingColumns; i++) {
          col.push(''); // Fill missing columns with empty strings
        }
      }
      // If col.length > 17, we'll just use the first 17 columns

      return {
        auctionName: col[0]?.trim() || '',
        pictureCount: parseInt(col[1]?.trim() || '0', 10) || 0,
        runNumber: col[2]?.trim() || '',
        stockNumber: col[3]?.trim() || '',
        year: parseInt(col[4]?.trim() || '0', 10) || 0,
        make: col[5]?.trim() || '',
        model: col[6]?.trim() || '',
        style: col[7]?.trim() || '',
        color: col[8]?.trim() || '',
        odometer: parseInt(col[9]?.trim().replace(',', '') || '0', 10) || 0,
        cr: col[10]?.trim() || '',
        grade: parseFloat(col[11]?.trim() || '0') || 0,
        saleDate: col[12]?.trim() || '',
        lane: col[13]?.trim() || '',
        vin: col[14]?.trim() || '',
        soldAmount: col[15]?.trim() || '',
        watchNotes: col[16]?.trim() || '',
      };
    })
    .filter((record): record is EdgePipelineRecord => record !== null && record.vin !== '');
}