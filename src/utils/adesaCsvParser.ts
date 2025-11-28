import { AdesaRecord } from '../interfaces/adesa.types';

/**
 * Parses Adesa CSV format
 * Expected columns: Lane / Run, Date, Sale Channel, Location, Year, Make, Model, Trim, VIN, Engine, Transmission, Drivetrain, Fuel, Exterior Color, Odometer, Grade, Condition Guarantee, Driveability, CarValue, Seller, Notes, Announcements, Title Status
 */
export function parseAdesaCSV(csv: string): AdesaRecord[] {
  const lines = csv.trim().split('\n');
  
  if (lines.length < 2) {
    return [];
  }

  // Skip header row
  const [, ...rows] = lines;

  return rows
    .map(row => {
      // Handle CSV parsing with proper quote handling
      const col = parseCSVRow(row);
      
      // If we have exactly 21 columns, notes might be empty - pad with empty strings
      if (col.length === 21) {
        col.push(''); // Add empty notes
        col.push(''); // Add empty announcements
        col.push(''); // Add empty titleStatus
      } else if (col.length === 22) {
        // Missing titleStatus, pad it
        col.push(''); // Add empty titleStatus
      } else if (col.length < 21) {
        // Truly insufficient columns (missing required fields)
        console.warn(`Row has insufficient columns (${col.length}), skipping: ${row.substring(0, 100)}`);
        return null;
      }
      // If col.length >= 23, we'll just use the first 23 columns (0-22)

      return {
        laneRun: col[0]?.trim() || '',
        date: col[1]?.trim() || '',
        saleChannel: col[2]?.trim() || '',
        location: col[3]?.trim() || '',
        year: parseInt(col[4]?.trim() || '0', 10) || 0,
        make: col[5]?.trim() || '',
        model: col[6]?.trim() || '',
        trim: col[7]?.trim() || '',
        vin: col[8]?.trim() || '',
        engine: col[9]?.trim() || '',
        transmission: col[10]?.trim() || '',
        drivetrain: col[11]?.trim() || '',
        fuel: col[12]?.trim() || '',
        exteriorColor: col[13]?.trim() || '',
        odometer: parseInt(col[14]?.trim().replace(',', '') || '0', 10) || 0,
        grade: parseFloat(col[15]?.trim() || '0') || 0,
        conditionGuarantee: col[16]?.trim() || '',
        driveability: col[17]?.trim() || '',
        carValue: col[18]?.trim() || '',
        seller: col[19]?.trim() || '',
        notes: col[20]?.trim() || '',
        announcements: col[21]?.trim() || '',
        titleStatus: col[22]?.trim() || '',
      };
    })
    .filter((record): record is AdesaRecord => record !== null && record.vin !== '');
}

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


