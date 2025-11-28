import { DCEngine } from '../services/dcengine';
import { IVehicle } from '../interfaces/vehicle.types';

// Placeholder values - update these as needed
const TEST_VIN = 'WBA8E5G54GNU21913';
const TEST_ODOMETER = 91691;
const TEST_MAKE = 'REPLACE_ME_MAKE';
const TEST_MODEL = 'REPLACE_ME_MODEL';
const TEST_YEAR = 2020;
const TEST_TRIM = '320i xDrive';
const TEST_TRANSMISSION = ''; // Empty string means transmission will be selected randomly if needed

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Testing completeVehicleBuild');
  console.log('='.repeat(60));
  console.log(`VIN: ${TEST_VIN}`);
  console.log(`Odometer: ${TEST_ODOMETER}`);
  console.log(`Make: ${TEST_MAKE}`);
  console.log(`Model: ${TEST_MODEL}`);
  console.log(`Year: ${TEST_YEAR}`);
  console.log(`Trim: ${TEST_TRIM}`);
  console.log(
    `Transmission: ${TEST_TRANSMISSION ||
      '(empty - will be randomly selected if needed)'}`,
  );
  console.log('='.repeat(60));
  console.log('');

  const dcEngine = new DCEngine();
  const page = await dcEngine.openScraper();

  try {
    const token = await dcEngine.getToken(page);
    if (!token) {
      throw new Error(
        'Failed to retrieve DealerCenter token. Ensure refresh token is valid.',
      );
    }

    console.log('✓ Successfully authenticated');
    console.log('');

    const vehicle: IVehicle = {
      vin: TEST_VIN,
      odometer: TEST_ODOMETER,
      make: TEST_MAKE,
      model: TEST_MODEL,
      year: TEST_YEAR,
      trim: TEST_TRIM,
      transmission: TEST_TRANSMISSION,
    };

    console.log('Starting completeVehicleBuild...');
    console.log('');

    const result = await dcEngine.completeVehicleBuild(page, vehicle);

    console.log('='.repeat(60));
    console.log('✓ completeVehicleBuild completed successfully');
    console.log('='.repeat(60));
    console.log('');

    // Display results
    console.log('Results:');
    console.log('-'.repeat(60));
    console.log(
      `Vehicle Builds: ${
        Array.isArray(result.vehicleBuilds) ? result.vehicleBuilds.length : 0
      } build(s) found`,
    );

    if (
      Array.isArray(result.vehicleBuilds) &&
      result.vehicleBuilds.length > 0
    ) {
      const firstBuild = result.vehicleBuilds[0];
      console.log('');
      console.log('First Vehicle Build:');
      console.log(`  - Make: ${firstBuild.make || 'N/A'}`);
      console.log(`  - Model: ${firstBuild.model || 'N/A'}`);
      console.log(`  - Year: ${firstBuild.year || 'N/A'}`);
      console.log(`  - Trim: ${firstBuild.trim || 'N/A'}`);
      console.log(`  - Body Type: ${firstBuild.bodyType || 'N/A'}`);
      console.log(`  - Transmission: ${firstBuild.transmission || 'N/A'}`);
      console.log(`  - Engine: ${firstBuild.engine || 'N/A'}`);
      console.log(`  - Drive Train: ${firstBuild.driveTrain || 'N/A'}`);
      console.log(`  - Fuel Type: ${firstBuild.fuelType || 'N/A'}`);
      console.log(`  - Model ID: ${firstBuild.modelIdentifier || 'N/A'}`);
    }

    console.log('');
    console.log(`City MPG: ${result.cityMpg || 'N/A'}`);
    console.log(`Highway MPG: ${result.highwayMpg || 'N/A'}`);
    console.log(`Vehicle Weight: ${result.vehicleWeight || 'N/A'}`);
    console.log(`Gross Vehicle Weight: ${result.grossVehicleWeight || 'N/A'}`);

    if (result.transmissionSelection) {
      console.log('');
      console.log('⚠️  Transmission Selection Notification:');
      console.log(`  - VIN: ${result.transmissionSelection.vin}`);
      console.log(
        `  - Selected Transmission: ${result.transmissionSelection.selectedTransmission.name} (ID: ${result.transmissionSelection.selectedTransmission.id})`,
      );
      console.log(
        `  - Vehicle Trim: ${result.transmissionSelection.vehicleTrim ||
          'N/A'}`,
      );
      console.log(
        `  - Inventory ID: ${result.transmissionSelection.inventoryId ||
          'N/A'}`,
      );
      console.log(`  - Available Options:`);
      result.transmissionSelection.availableOptions.forEach((option, index) => {
        console.log(`    ${index + 1}. ${option.name} (ID: ${option.id})`);
      });
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Test completed successfully!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ Error occurred during test');
    console.error('='.repeat(60));
    console.error('');
    console.error('Error details:');
    if (error instanceof Error) {
      console.error(error.message);
      if (error.stack) {
        console.error('');
        console.error('Stack trace:');
        console.error(error.stack);
      }
    } else {
      console.error(error);
    }
    throw error;
  } finally {
    await dcEngine.close();
    console.log('');
    console.log('Browser closed.');
  }
}

main().catch(console.error);
