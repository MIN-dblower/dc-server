import prisma from '../lib/prisma';
import { EdgePipelineRecord } from '../interfaces/edgePipeline.types';

function mapEntryToEdgeRecord(entry: any): EdgePipelineRecord {
  return {
    auctionName: entry.auctionName,
    pictureCount: entry.pictureCount,
    runNumber: entry.runNumber,
    stockNumber: entry.stockNumber,
    year: entry.year,
    make: entry.make,
    model: entry.model,
    style: entry.style,
    color: entry.color,
    odometer: entry.odometer,
    cr: entry.cr,
    grade: entry.grade,
    saleDate: entry.saleDate,
    lane: entry.lane,
    vin: entry.vin,
    soldAmount: entry.soldAmount,
    watchNotes: entry.watchNotes,
  };
}

/**
 * Loads the last known records from the database and returns them as a VIN-keyed map.
 */
export async function loadRecordMap(): Promise<Record<string, EdgePipelineRecord>> {
  const delegate = (prisma as any).edgePipelineRecord ?? prisma.edgePipelineRecord;
  const entries = await delegate.findMany();
  const map: Record<string, EdgePipelineRecord> = {};
  entries.forEach((entry: any) => {
    map[entry.vin] = mapEntryToEdgeRecord(entry);
  });
  return map;
}

/**
 * Loads a single EdgePipeline record by VIN or returns null when not found.
 */
export async function getEdgePipelineRecordByVin(
  vin: string,
): Promise<EdgePipelineRecord | null> {
  const delegate = (prisma as any).edgePipelineRecord ?? prisma.edgePipelineRecord;
  const entry = await delegate.findUnique({ where: { vin } });
  if (!entry) {
    return null;
  }
  return mapEntryToEdgeRecord(entry);
}

/**
 * Inserts or updates an EdgePipelineRecord in the database based on its VIN.
 */
export async function saveOrUpdateRecord(record: EdgePipelineRecord): Promise<void> {
  const delegate = (prisma as any).edgePipelineRecord ?? prisma.edgePipelineRecord;
  await delegate.upsert({
    where: { vin: record.vin },
    create: {
      auctionName: record.auctionName,
      pictureCount: record.pictureCount,
      runNumber: record.runNumber,
      stockNumber: record.stockNumber,
      year: record.year,
      make: record.make,
      model: record.model,
      style: record.style,
      color: record.color,
      odometer: record.odometer,
      cr: record.cr,
      grade: record.grade,
      saleDate: record.saleDate,
      lane: record.lane,
      vin: record.vin,
      soldAmount: record.soldAmount,
      watchNotes: record.watchNotes,
    },
    update: {
      auctionName: record.auctionName,
      pictureCount: record.pictureCount,
      runNumber: record.runNumber,
      stockNumber: record.stockNumber,
      year: record.year,
      make: record.make,
      model: record.model,
      style: record.style,
      color: record.color,
      odometer: record.odometer,
      cr: record.cr,
      grade: record.grade,
      saleDate: record.saleDate,
      lane: record.lane,
      soldAmount: record.soldAmount,
      watchNotes: record.watchNotes,
    },
  });
}