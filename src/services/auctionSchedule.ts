import { DateTime } from 'luxon';

export enum AuctionType {
  ADESA = 'adesa',
  EDGE = 'edge',
}

export interface MonitoringWindow {
  startDate: Date;
  endDate: Date;
  auctionDate: Date;
  auctionType: AuctionType;
  fileName: string;
}

export const DEFAULT_TIME_ZONE = 'America/Chicago';

function getCurrentDateTime(currentDate?: Date): DateTime {
  return currentDate
    ? DateTime.fromJSDate(currentDate, { zone: DEFAULT_TIME_ZONE })
    : DateTime.now().setZone(DEFAULT_TIME_ZONE);
}

function getNextWeekday(base: DateTime, targetWeekday: number): DateTime {
  const diff = (targetWeekday - base.weekday + 7) % 7 || 7;
  return base.plus({ days: diff }).startOf('day');
}

function getPreviousWeekday(base: DateTime, targetWeekday: number): DateTime {
  const diff = (base.weekday - targetWeekday + 7) % 7 || 7;
  return base.minus({ days: diff }).startOf('day');
}

function formatDateForFilename(dt: DateTime): string {
  return dt.toFormat('MM-dd-yyyy');
}

function toJSDate(dt: DateTime): Date {
  return dt.toJSDate();
}

export function getAdesaMonitoringWindow(currentDate?: Date): MonitoringWindow {
  const now = getCurrentDateTime(currentDate);
  const auctionDate = getNextWeekday(now, 3); // Wednesday
  const start = getPreviousWeekday(auctionDate, 5); // Friday 00:00
  const end = auctionDate.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });

  return {
    startDate: toJSDate(start),
    endDate: toJSDate(end),
    auctionDate: toJSDate(auctionDate),
    auctionType: AuctionType.ADESA,
    fileName: `adesa-${formatDateForFilename(auctionDate)}`,
  };
}

export function getEdgeMonitoringWindow(currentDate?: Date): MonitoringWindow {
  const now = getCurrentDateTime(currentDate);
  const auctionDate = getNextWeekday(now, 4); // Thursday
  const start = getPreviousWeekday(auctionDate, 1); // Monday 00:00
  const end = auctionDate.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });

  return {
    startDate: toJSDate(start),
    endDate: toJSDate(end),
    auctionDate: toJSDate(auctionDate),
    auctionType: AuctionType.EDGE,
    fileName: `americas-${formatDateForFilename(auctionDate)}`,
  };
}

export function isWithinMonitoringWindow(window: MonitoringWindow, currentDate?: Date): boolean {
  const now = getCurrentDateTime(currentDate);
  const start = DateTime.fromJSDate(window.startDate, { zone: DEFAULT_TIME_ZONE });
  const end = DateTime.fromJSDate(window.endDate, { zone: DEFAULT_TIME_ZONE });
  return now >= start && now <= end;
}

export function getActiveMonitoringWindow(
  auctionType: AuctionType,
  currentDate?: Date
): MonitoringWindow | null {
  const window =
    auctionType === AuctionType.ADESA
      ? getAdesaMonitoringWindow(currentDate)
      : getEdgeMonitoringWindow(currentDate);

  return isWithinMonitoringWindow(window, currentDate) ? window : null;
}

export function getActiveMonitoringWindows(currentDate?: Date): MonitoringWindow[] {
  const windows: MonitoringWindow[] = [];

  const adesaWindow = getActiveMonitoringWindow(AuctionType.ADESA, currentDate);
  if (adesaWindow) windows.push(adesaWindow);

  const edgeWindow = getActiveMonitoringWindow(AuctionType.EDGE, currentDate);
  if (edgeWindow) windows.push(edgeWindow);

  return windows;
}
