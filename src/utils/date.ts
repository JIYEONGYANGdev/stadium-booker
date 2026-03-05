export function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextNextWeekday(targetDow: number, baseDate: Date = new Date()): Date {
  const dow = baseDate.getDay(); // 0 (Sun) - 6 (Sat)
  const daysUntilTarget = (targetDow - dow + 7) % 7;
  const daysToNextNext = daysUntilTarget + 14;
  const result = new Date(baseDate);
  result.setDate(baseDate.getDate() + daysToNextNext);
  return result;
}
