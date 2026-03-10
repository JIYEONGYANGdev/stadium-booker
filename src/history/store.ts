import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReservationRecord {
  reservation: string;
  site: string;
  facility: string;
  court: string;
  slot_time?: string;
  timestamp: string;
}

const DATA_DIR = resolve('data');
const HISTORY_FILE = resolve(DATA_DIR, 'reservations.json');

function loadRecords(): ReservationRecord[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const raw = readFileSync(HISTORY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords(records: ReservationRecord[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2));
}

export function recordSuccess(record: ReservationRecord): void {
  const records = loadRecords();
  records.push(record);
  saveRecords(records);
}

export function getMonthlySuccessCount(date: Date = new Date()): number {
  return getMonthlySuccessRecords(date).length;
}

export function getMonthlySuccessRecords(date: Date = new Date()): ReservationRecord[] {
  const records = loadRecords();
  const year = date.getFullYear();
  const month = date.getMonth();

  return records.filter((entry) => {
    const entryDate = new Date(entry.timestamp);
    return entryDate.getFullYear() === year && entryDate.getMonth() === month;
  });
}
