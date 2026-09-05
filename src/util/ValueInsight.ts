/**
 * Human-readable explanations for opaque cell values: UUIDs and the many shapes
 * a timestamp takes in a database column.
 *
 * Kept free of any VS Code or DOM dependency so it can be unit tested and called
 * from the webview host.
 */

export type InsightKind = 'uuid' | 'timestamp' | 'unknown';

export interface ValueInsight {
  kind: InsightKind;
  title: string;
  /** Label/value pairs, rendered as a small table. */
  details: { label: string; value: string }[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gregorian epoch (1582-10-15) to Unix epoch, in milliseconds — the v1 offset. */
const UUID_V1_EPOCH_OFFSET_MS = 12219292800000;

/** Plausible range for a real timestamp: 1990-01-01 .. 2100-01-01, in seconds. */
const MIN_EPOCH_SECONDS = 631152000;
const MAX_EPOCH_SECONDS = 4102444800;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Interprets a number as a Unix timestamp, guessing the unit from magnitude.
 * Returns null when no unit puts it in a believable range, so ordinary integer
 * columns are not mistaken for dates.
 */
export function epochToDate(value: number): { date: Date; unit: 'seconds' | 'milliseconds' | 'microseconds' } | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  const candidates: { unit: 'seconds' | 'milliseconds' | 'microseconds'; seconds: number }[] = [
    { unit: 'seconds', seconds: value },
    { unit: 'milliseconds', seconds: value / 1000 },
    { unit: 'microseconds', seconds: value / 1000000 },
  ];

  for (const candidate of candidates) {
    if (candidate.seconds >= MIN_EPOCH_SECONDS && candidate.seconds <= MAX_EPOCH_SECONDS) {
      return { date: new Date(candidate.seconds * 1000), unit: candidate.unit };
    }
  }
  return null;
}

/** "3 days ago" / "in 2 hours", relative to `now`. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);

  const units: [string, number][] = [
    ['year', 365 * 24 * 3600 * 1000],
    ['month', 30 * 24 * 3600 * 1000],
    ['day', 24 * 3600 * 1000],
    ['hour', 3600 * 1000],
    ['minute', 60 * 1000],
    ['second', 1000],
  ];

  for (const [name, ms] of units) {
    if (abs >= ms) {
      const count = Math.floor(abs / ms);
      const plural = count === 1 ? name : `${name}s`;
      return future ? `in ${count} ${plural}` : `${count} ${plural} ago`;
    }
  }
  return 'just now';
}

/**
 * Version and, for the time-ordered versions, the moment encoded in a UUID.
 * v1 stores 100-nanosecond intervals since 1582; v7 stores Unix milliseconds.
 */
export function describeUuid(value: string): ValueInsight | null {
  const uuid = value.trim().toLowerCase();
  if (!isUuid(uuid)) return null;

  const hex = uuid.replace(/-/g, '');
  const version = parseInt(hex[12], 16);
  const variantNibble = parseInt(hex[16], 16);
  const variant = variantNibble >= 8 && variantNibble <= 11 ? 'RFC 4122' : variantNibble >= 12 ? 'Microsoft/reserved' : 'NCS (legacy)';

  const details: { label: string; value: string }[] = [
    { label: 'Version', value: `v${version}` },
    { label: 'Variant', value: variant },
  ];

  if (version === 1) {
    // time_low + time_mid + time_hi, in 100ns ticks since the Gregorian epoch.
    const timeHigh = hex.slice(13, 16);
    const timeMid = hex.slice(8, 12);
    const timeLow = hex.slice(0, 8);
    const ticks = BigInt('0x' + timeHigh + timeMid + timeLow);
    const ms = Number(ticks / 10000n) - UUID_V1_EPOCH_OFFSET_MS;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      details.push({ label: 'Created (UTC)', value: date.toISOString() });
      details.push({ label: 'Relative', value: relativeTime(date) });
    }
    details.push({ label: 'Node (MAC)', value: hex.slice(20).replace(/(..)(?=.)/g, '$1:') });
  } else if (version === 7) {
    const ms = Number(BigInt('0x' + hex.slice(0, 12)));
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      details.push({ label: 'Created (UTC)', value: date.toISOString() });
      details.push({ label: 'Relative', value: relativeTime(date) });
    }
  } else if (version === 4) {
    details.push({ label: 'Note', value: 'Random UUID — carries no timestamp' });
  }

  return { kind: 'uuid', title: `UUID v${version}`, details };
}

/** Renders a date in every form worth seeing next to a cell. */
function timestampInsight(date: Date, sourceLabel: string): ValueInsight {
  return {
    kind: 'timestamp',
    title: 'Timestamp',
    details: [
      { label: 'Source', value: sourceLabel },
      { label: 'UTC', value: date.toISOString() },
      { label: 'Local', value: date.toString() },
      { label: 'Unix (s)', value: String(Math.floor(date.getTime() / 1000)) },
      { label: 'Unix (ms)', value: String(date.getTime()) },
      { label: 'Relative', value: relativeTime(date) },
    ],
  };
}

/**
 * Explains a cell value, or returns null when there is nothing interesting to
 * say about it.
 */
export function describeValue(value: unknown): ValueInsight | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : timestampInsight(value, 'Date object');
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    const epoch = epochToDate(Number(value));
    return epoch ? timestampInsight(epoch.date, `Unix epoch (${epoch.unit})`) : null;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const uuid = describeUuid(text);
  if (uuid) return uuid;

  // A bare number in a text column is still a plausible epoch.
  if (/^\d+$/.test(text)) {
    const epoch = epochToDate(Number(text));
    return epoch ? timestampInsight(epoch.date, `Unix epoch (${epoch.unit})`) : null;
  }

  // ISO-8601 and the `YYYY-MM-DD HH:MM:SS` form most drivers hand back.
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(text)) {
    const date = new Date(text.includes('T') || !text.includes(' ') ? text : text.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) {
      return timestampInsight(date, 'ISO-8601 text');
    }
  }

  return null;
}
