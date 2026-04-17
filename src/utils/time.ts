import { logger } from './logger.js';

export function parseTimeString(time: string): { hours: number; minutes: number; seconds: number } {
  const parts = time.split(':').map(Number);
  return {
    hours: parts[0]!,
    minutes: parts[1]!,
    seconds: parts[2] ?? 0,
  };
}

/** year, month(0-indexed) 기준 말일 Date 반환 */
function lastDateOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function isLastDayOfMonth(date: Date = new Date()): boolean {
  return date.getDate() === lastDateOfMonth(date.getFullYear(), date.getMonth());
}

export function getNextOpenTime(
  type: 'monthly' | 'weekly' | 'daily',
  time: string,
  day?: number | 'last',
  dayOfWeek?: string,
): Date {
  const now = new Date();
  const { hours, minutes, seconds } = parseTimeString(time);

  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  const target = new Date(now);
  target.setHours(hours, minutes, seconds, 0);

  if (type === 'daily') {
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }
  } else if (type === 'weekly' && dayOfWeek) {
    const targetDay = dayMap[dayOfWeek]!;
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && target <= now)) {
      daysUntil += 7;
    }
    target.setDate(target.getDate() + daysUntil);
  } else if (type === 'monthly' && day !== undefined) {
    if (day === 'last') {
      // 이번 달 말일로 세팅
      target.setDate(lastDateOfMonth(target.getFullYear(), target.getMonth()));
      if (target <= now) {
        // 다음 달 말일
        const nextMonth = target.getMonth() + 1;
        target.setMonth(nextMonth);
        target.setDate(lastDateOfMonth(target.getFullYear(), target.getMonth()));
      }
    } else {
      target.setDate(day);
      if (target <= now) {
        target.setMonth(target.getMonth() + 1);
      }
    }
  }

  return target;
}

export function toCronExpression(
  type: 'monthly' | 'weekly' | 'daily',
  time: string,
  day?: number | 'last',
  dayOfWeek?: string,
): string {
  const { hours, minutes, seconds } = parseTimeString(time);
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  // 오픈 5분 전에 트리거 (브라우저 준비 시간)
  let triggerMinutes = minutes - 5;
  let triggerHours = hours;
  if (triggerMinutes < 0) {
    triggerMinutes += 60;
    triggerHours -= 1;
  }

  switch (type) {
    case 'daily':
      return `${seconds} ${triggerMinutes} ${triggerHours} * * *`;
    case 'weekly':
      return `${seconds} ${triggerMinutes} ${triggerHours} * * ${dayMap[dayOfWeek!]}`;
    case 'monthly':
      // 'last'는 cron이 지원하지 않으므로 28-31에 매일 트리거하고
      // 스케줄러에서 runtime에 isLastDayOfMonth로 gate한다.
      if (day === 'last') {
        return `${seconds} ${triggerMinutes} ${triggerHours} 28-31 * *`;
      }
      return `${seconds} ${triggerMinutes} ${triggerHours} ${day} * *`;
  }
}

export async function waitUntil(targetTime: Date): Promise<void> {
  const now = Date.now();
  const target = targetTime.getTime();
  const diff = target - now;

  if (diff <= 0) return;

  logger.info(`오픈까지 ${Math.ceil(diff / 1000)}초 대기...`);

  // 10초 전까지는 1초 간격으로 대기
  if (diff > 10_000) {
    await sleep(diff - 10_000);
  }

  // 10초 전부터 100ms 간격으로 정밀 대기
  while (Date.now() < target) {
    await sleep(100);
  }

  logger.info('오픈 시간 도달!');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
