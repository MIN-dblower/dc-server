import { DCEngine } from '@services/dcengine';
import { IVehicle } from '@interfaces/vehicle.types';

/**
 * Update these values before running the script.
 * Leave transmission blank to let DealerCenter auto-select when needed.
 */
const TEST_VEHICLE: IVehicle = {
  vin: '3GCUDFED7RG462942',
  make: 'Chevrolet',
  model: 'Silverado 1500',
  year: 0,
  trim: 'LT Trail Boss',
  odometer: 22715,
  transmission: '',
  color: "White",
  grade: 4.6
};

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('DealerCenter VIN Registration Test');
  console.log('='.repeat(60));
  console.log(`VIN: ${TEST_VEHICLE.vin}`);
  console.log(`Odometer: ${TEST_VEHICLE.odometer}`);
  console.log(`Make/Model/Trim/Year: ${TEST_VEHICLE.make} ${TEST_VEHICLE.model} ${TEST_VEHICLE.trim} ${TEST_VEHICLE.year}`);
  console.log(
    `Transmission: ${TEST_VEHICLE.transmission || '(empty - will auto-select if required)'}`,
  );
  console.log('='.repeat(60));
  console.log('');

  const dcEngine = new DCEngine();
  const page = await dcEngine.openScraper();

  try {
    let token = await dcEngine.getToken(page);
    if (!token) {
      console.log('No valid token found. Attempting interactive login...');
      await dcEngine.forceLogin(page);
      token = await dcEngine.getToken(page);
    }

    if (!token) {
      throw new Error(
        'Failed to retrieve DealerCenter token. Check login/refresh token.',
      );
    }

    dcEngine.setToken(token);
    console.log('✓ Authenticated with DealerCenter');
    console.log('');

    console.log('Checking existing inventory for VIN...');
    const existingInventoryId = await dcEngine.getInventoryByVin(
      page,
      TEST_VEHICLE.vin,
    );

    if (existingInventoryId) {
      console.log(
        `Inventory already exists for VIN ${TEST_VEHICLE.vin}: ${existingInventoryId}`,
      );
      return;
    }

    console.log('No inventory found. Starting registration...');
    const registerResult = await dcEngine.registerInventory(page, TEST_VEHICLE);

    if (!registerResult.isCompleted) {
      console.error('❌ Registration failed');
      console.error(
        `Reason: ${registerResult.error || 'Unknown error during registration'}`,
      );
      return;
    }

    console.log('✓ Registration completed successfully');

    if (registerResult.autoSelection) {
      const { autoSelection } = registerResult;
      console.log('');
      console.log('⚠️  Auto-selection applied during registration');
      console.log(`Key: ${autoSelection.key}`);
      console.log(
        `Selected: ${autoSelection.selectedOption.name} (ID: ${autoSelection.selectedOption.id})`,
      );
      console.log(
        `Available options: ${autoSelection.availableOptions
          .map(opt => opt.name)
          .join(', ')}`,
      );
      if (autoSelection.vehicleTrim) {
        console.log(`Vehicle Trim: ${autoSelection.vehicleTrim}`);
      }
      if (autoSelection.inventoryId) {
        console.log(`Inventory ID: ${autoSelection.inventoryId}`);
      }
    }

    const inventoryId = await dcEngine.getInventoryByVin(
      page,
      TEST_VEHICLE.vin,
    );
    console.log('');
    console.log(
      `Lookup after registration -> Inventory ID: ${inventoryId || 'not found'}`,
    );
    console.log('');
    console.log('='.repeat(60));
    console.log('Test finished');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ Error during VIN registration test');
    console.error('='.repeat(60));
    console.error('');
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

