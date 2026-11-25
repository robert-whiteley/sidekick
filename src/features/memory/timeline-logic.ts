/** Groups items (newest first) into days with a plain heading: Today, Yesterday, "Mon 3 Nov". */
export function groupByDay<T extends { at: number }>(
  items: T[],
  now = new Date(),
): { day: string; items: T[] }[] {
  const start = (t: number | Date) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = start(now);
  const out: { day: string; items: T[] }[] = [];
  let key = NaN;
  for (const it of items) {
    const k = start(it.at);
    if (k !== key) {
      key = k;
      const days = Math.round((today - k) / 86_400_000);
      const day =
        days === 0
          ? 'Today'
          : days === 1
            ? 'Yesterday'
            : new Date(k).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                ...(new Date(k).getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
              });
      out.push({ day, items: [] });
    }
    out[out.length - 1].items.push(it);
  }
  return out;
}
