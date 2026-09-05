import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeUuid,
  describeValue,
  epochToDate,
  isUuid,
  relativeTime,
} from '../src/util/ValueInsight.js';

test('recognises UUIDs', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isUuid('550E8400-E29B-41D4-A716-446655440000'), true);
  assert.equal(isUuid('550e8400e29b41d4a716446655440000'), false);
  assert.equal(isUuid('not-a-uuid'), false);
});

test('reports version and variant of a v4 UUID', () => {
  const insight = describeUuid('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(insight?.title, 'UUID v4');
  assert.deepEqual(insight?.details[0], { label: 'Version', value: 'v4' });
  assert.equal(insight?.details[1].value, 'RFC 4122');
  assert.match(insight?.details[2].value ?? '', /Random/);
});

test('extracts the embedded timestamp from a v1 UUID', () => {
  // Expected value cross-checked against Python's uuid module, which decodes
  // this UUID's time field as 1998-03-13 13:56:50.243247+00:00.
  const insight = describeUuid('1d19dad6-ba7b-11d1-80b4-00c04fd430c8');
  assert.equal(insight?.title, 'UUID v1');
  const created = insight?.details.find((d) => d.label === 'Created (UTC)');
  assert.match(created?.value ?? '', /^1998-03-13T13:56:50/);
  assert.ok(insight?.details.some((d) => d.label === 'Node (MAC)'));
});

test('extracts the embedded timestamp from a v7 UUID', () => {
  // First 48 bits are Unix milliseconds: 0x018f0d4c1e00 -> 2024-04-19T12:00:00Z-ish.
  const ms = Date.UTC(2024, 3, 19, 12, 0, 0);
  const hex = ms.toString(16).padStart(12, '0');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-8def-0123456789ab`;
  const insight = describeUuid(uuid);
  assert.equal(insight?.title, 'UUID v7');
  const created = insight?.details.find((d) => d.label === 'Created (UTC)');
  assert.equal(created?.value, new Date(ms).toISOString());
});

test('guesses the unit of an epoch number', () => {
  assert.equal(epochToDate(1700000000)?.unit, 'seconds');
  assert.equal(epochToDate(1700000000000)?.unit, 'milliseconds');
  assert.equal(epochToDate(1700000000000000)?.unit, 'microseconds');
});

test('ordinary small integers are not mistaken for timestamps', () => {
  assert.equal(epochToDate(1), null);
  assert.equal(epochToDate(42), null);
  assert.equal(epochToDate(0), null);
  assert.equal(epochToDate(-1700000000), null);
  assert.equal(describeValue(7), null);
});

test('describes epoch numbers in every common form', () => {
  const insight = describeValue(1700000000);
  assert.equal(insight?.kind, 'timestamp');
  const utc = insight?.details.find((d) => d.label === 'UTC');
  assert.equal(utc?.value, '2023-11-14T22:13:20.000Z');
  assert.equal(insight?.details.find((d) => d.label === 'Unix (s)')?.value, '1700000000');
  assert.match(insight?.details.find((d) => d.label === 'Source')?.value ?? '', /seconds/);
});

test('describes ISO-8601 and driver-style timestamp text', () => {
  assert.equal(describeValue('2024-01-15T10:30:00Z')?.kind, 'timestamp');
  assert.equal(describeValue('2024-01-15 10:30:00')?.kind, 'timestamp');
  assert.equal(describeValue('2024-01-15')?.kind, 'timestamp');
});

test('describes Date objects and skips invalid ones', () => {
  assert.equal(describeValue(new Date('2024-01-15T00:00:00Z'))?.kind, 'timestamp');
  assert.equal(describeValue(new Date('nonsense')), null);
});

test('returns null for values with nothing to explain', () => {
  assert.equal(describeValue(null), null);
  assert.equal(describeValue(undefined), null);
  assert.equal(describeValue(''), null);
  assert.equal(describeValue('hello world'), null);
  assert.equal(describeValue({ a: 1 }), null);
});

test('formats relative time in both directions', () => {
  const now = new Date('2024-01-15T12:00:00Z');
  assert.equal(relativeTime(new Date('2024-01-15T11:59:59Z'), now), '1 second ago');
  assert.equal(relativeTime(new Date('2024-01-15T09:00:00Z'), now), '3 hours ago');
  assert.equal(relativeTime(new Date('2024-01-18T12:00:00Z'), now), 'in 3 days');
  assert.equal(relativeTime(new Date('2024-01-15T12:00:00Z'), now), 'just now');
});
