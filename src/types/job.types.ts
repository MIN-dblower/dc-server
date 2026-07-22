import { AuctionRecordUnion } from '../services/dcUpdateInterface';

export const DC_UPDATE_QUEUE = 'dc-update-queue';
export const DC_UPDATE_JOB = 'dc-update-job';

export const TELEGRAM_MESSAGE_QUEUE = 'telegram-message-queue';
export const TELEGRAM_MESSAGE_JOB = 'telegram-message-job';

export interface DCUpdateJobData {
  record: AuctionRecordUnion;
  isNewRecord: boolean;
  auctionType: 'Adesa' | 'Edge Pipeline';
  fileId: string;
  fileName: string;
  timestamp: string; // ISO string for easier serialization
}

export interface CompFilters {
  odometerMin: number | null;
  odometerMax: number | null;
  radiusInMiles: number;
  years?: number[];
  trims?: string[];
}

export interface DCSyncCompletedDetails {
  inventoryId: string;
  auctionType: 'Adesa' | 'Edge Pipeline';
  auctionLocation: string;
  odometer: number;
  compFilters: CompFilters;
  pricingSummary?: {
    marketAveragePrice: number;
    askingPrice: number;
    appraisalValue: number;
    reconCost: number;
  };
}

export interface TelegramMessageJobData {
  type: 'uncovered_case' | 'blocked_vin_attempt' | 'job_failure' | 'queue_backup' | 'system_health' | 'auto_selection_mode' | 'dc_sync_completed' | 'mfa_required';
  vin?: string;
  question?: any;
  vehicleTrim?: string;
  jobId?: string;
  error?: string;
  queueLength?: number;
  oldestJobTime?: string;
  component?: string;
  status?: string;
  details?: any;
  dcSyncDetails?: DCSyncCompletedDetails;
}

export interface JobStatusSummary {
  jobId: string;
  vin: string;
  state: string;
  attemptsMade: number;
  failedReason?: string;
  nextRunAt?: string;
}

