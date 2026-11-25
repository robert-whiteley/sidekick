export type Option<T> = { value: T; label: string };

export type Chip<T> = {
  value: T;
  label: string;
  selected: boolean;
  recommended: boolean;
  /** What to store when tapped: null = follow the Recommended value. */
  store: T | null;
};

/**
 * Chips for a setting with a Recommended value. Picking the Recommended chip stores null, so the
 * setting keeps following the phone's Recommended value as it is refined.
 */
export function choiceChips<T>(
  options: Option<T>[],
  value: T | null,
  rec: T,
  format: (v: T) => string = String,
): Chip<T>[] {
  // A Recommended value between the fixed choices (e.g. 11 GB) gets its own chip, in order.
  const all = options.some((o) => o.value === rec)
    ? options
    : [...options, { value: rec, label: format(rec) }].sort((a, b) =>
        typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : 0,
      );
  const current = value ?? rec;
  return all.map((o) => ({
    value: o.value,
    label: o.value === rec ? `${o.label} (Recommended)` : o.label,
    selected: o.value === current,
    recommended: o.value === rec,
    store: o.value === rec ? null : o.value,
  }));
}

/** Plain-words label for a number of hours. */
export function hoursLabel(h: number): string {
  if (h < 24) return `${h} hours`;
  const d = h / 24;
  if (d === 7) return '1 week';
  if (d >= 28 && d <= 31) return '1 month';
  return d === 1 ? '1 day' : `${d} days`;
}

export function daysLabel(d: number): string {
  if (d === 0) return 'Forever';
  if (d === 7) return '1 week';
  if (d === 30) return '1 month';
  if (d === 90) return '3 months';
  if (d === 365) return '1 year';
  return `${d} days`;
}
