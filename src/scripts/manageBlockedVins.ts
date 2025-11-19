/**
 * Utility script to manage blocked VINs
 * 
 * Usage:
 *   List all blocked VINs:
 *     npx ts-node src/scripts/manageBlockedVins.ts list
 * 
 *   View details for a VIN:
 *     npx ts-node src/scripts/manageBlockedVins.ts view <VIN>
 * 
 *   Unblock a VIN:
 *     npx ts-node src/scripts/manageBlockedVins.ts unblock <VIN>
 */

import * as dotenv from 'dotenv';
import { getAllBlockedVins, getBlockedVinDetails, unblockVin } from '../services/blockedVins';

dotenv.config();

async function main(): Promise<void> {
  const command = process.argv[2];
  const vin = process.argv[3];

  if (command === 'list') {
    console.log('\n📋 Blocked VINs:\n');
    const blockedVins = await getAllBlockedVins();
    if (blockedVins.length === 0) {
      console.log('✅ No blocked VINs');
    } else {
      blockedVins.forEach((v, index) => {
        console.log(`${index + 1}. ${v}`);
      });
      console.log(`\nTotal: ${blockedVins.length} blocked VIN(s)`);
    }
  } else if (command === 'view' && vin) {
    console.log(`\n🔍 Details for VIN: ${vin}\n`);
    const details = await getBlockedVinDetails(vin);
    if (!details) {
      console.log('❌ VIN is not blocked or details not found');
    } else {
      console.log(JSON.stringify(details, null, 2));
    }
  } else if (command === 'unblock' && vin) {
    console.log(`\n🔓 Unblocking VIN: ${vin}\n`);
    const details = await getBlockedVinDetails(vin);
    if (!details) {
      console.log('❌ VIN is not blocked');
      process.exit(1);
    }
    await unblockVin(vin);
    console.log(`✅ VIN ${vin} has been unblocked`);
    console.log(`\n⚠️  Make sure you've fixed the issue before unblocking!`);
    console.log(`   Reason: ${details.reason}`);
  } else {
    console.log(`
Usage:
  list                    - List all blocked VINs
  view <VIN>              - View details for a blocked VIN
  unblock <VIN>           - Unblock a VIN (use after fixing the issue)
    `);
    process.exit(1);
  }

  process.exit(0);
}

void main();

