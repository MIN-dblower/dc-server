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

export interface TelegramMessageJobData {
  type: 'uncovered_case' | 'blocked_vin_attempt' | 'job_failure' | 'queue_backup' | 'system_health' | 'auto_selection_mode';
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
}

export interface JobStatusSummary {
  jobId: string;
  vin: string;
  state: string;
  attemptsMade: number;
  failedReason?: string;
  nextRunAt?: string;
}

