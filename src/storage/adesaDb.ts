import prisma from '../lib/prisma';
import { AdesaRecord } from '../interfaces/adesa.types';

/**
 * Loads all Adesa records from the database and returns them as a VIN-keyed map
 */
export async function loadAdesaRecordMap(): Promise<Record<string, AdesaRecord>> {
  const delegate = (prisma as any).adesaAuctionRecord ?? prisma.adesaAuctionRecord;
  const entries = await delegate.findMany();
  const map: Record<string, AdesaRecord> = {};
  
  entries.forEach((entry: any) => {
    map[entry.vin] = {
      laneRun: entry.laneRun,
      date: entry.date,
      saleChannel: entry.saleChannel,
      location: entry.location,
      year: entry.year,
      make: entry.make,
      model: entry.model,
      trim: entry.trim,
      vin: entry.vin,
      engine: entry.engine,
      transmission: entry.transmission,
      drivetrain: entry.drivetrain,
      fuel: entry.fuel,
      exteriorColor: entry.exteriorColor,
      odometer: entry.odometer,
      grade: entry.grade,
      conditionGuarantee: entry.conditionGuarantee,
      driveability: entry.driveability,
      carValue: entry.carValue,
      seller: entry.seller,
      notes: entry.notes,
      announcements: entry.announcements,
      titleStatus: entry.titleStatus,
    };
  });
  
  return map;
}

/**
 * Inserts or updates an AdesaRecord in the database based on its VIN
 */
export async function saveOrUpdateAdesaRecord(record: AdesaRecord): Promise<void> {
  const delegate = (prisma as any).adesaAuctionRecord ?? prisma.adesaAuctionRecord;
  await delegate.upsert({
    where: { vin: record.vin },
    create: {
      laneRun: record.laneRun,
      date: record.date,
      saleChannel: record.saleChannel,
      location: record.location,
      year: record.year,
      make: record.make,
      model: record.model,
      trim: record.trim,
      vin: record.vin,
      engine: record.engine,
      transmission: record.transmission,
      drivetrain: record.drivetrain,
      fuel: record.fuel,
      exteriorColor: record.exteriorColor,
      odometer: record.odometer,
      grade: record.grade,
      conditionGuarantee: record.conditionGuarantee,
      driveability: record.driveability,
      carValue: record.carValue,
      seller: record.seller,
      notes: record.notes,
      announcements: record.announcements,
      titleStatus: record.titleStatus,
    },
    update: {
      laneRun: record.laneRun,
      date: record.date,
      saleChannel: record.saleChannel,
      location: record.location,
      year: record.year,
      make: record.make,
      model: record.model,
      trim: record.trim,
      engine: record.engine,
      transmission: record.transmission,
      drivetrain: record.drivetrain,
      fuel: record.fuel,
      exteriorColor: record.exteriorColor,
      odometer: record.odometer,
      grade: record.grade,
      conditionGuarantee: record.conditionGuarantee,
      driveability: record.driveability,
      carValue: record.carValue,
      seller: record.seller,
      notes: record.notes,
      announcements: record.announcements,
      titleStatus: record.titleStatus,
    },
  });
}


