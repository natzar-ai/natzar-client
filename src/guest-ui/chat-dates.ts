// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
/** Compare dates in the viewer's timezone. */
export function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function groupByDay<T extends {sentAt: string}>(messages: T[]): T[][] {
  const days: T[][] = [];
  for (const message of messages) {
    const lastDay = days.at(-1);
    if (lastDay && sameDay(lastDay[0].sentAt, message.sentAt)) lastDay.push(message);
    else days.push([message]);
  }
  return days;
}
