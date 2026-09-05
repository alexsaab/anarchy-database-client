import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKnnQuery,
  buildKnnQueryForRow,
  cosineDistance,
  cosineSimilarity,
  declaredDimensions,
  formatVectorLiteral,
  isVectorColumn,
  parseVector,
  summarizeVector,
} from '../src/sql/VectorQuery.js';

test('recognises pgvector column types', () => {
  assert.equal(isVectorColumn({ type: 'vector' }), true);
  assert.equal(isVectorColumn({ type: 'vector(1536)' }), true);
  assert.equal(isVectorColumn({ type: 'halfvec(768)' }), true);
  assert.equal(isVectorColumn({ type: 'sparsevec' }), true);
  assert.equal(isVectorColumn({ type: 'text' }), false);
  assert.equal(isVectorColumn({ type: 'character varying(255)' }), false);
});

test('reads the declared dimension count', () => {
  assert.equal(declaredDimensions({ type: 'vector(1536)' }), 1536);
  assert.equal(declaredDimensions({ type: 'vector' }), undefined);
});

test('parses embeddings from pgvector text, JSON arrays and real arrays', () => {
  assert.deepEqual(parseVector('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(parseVector('[0.5, -0.25]'), [0.5, -0.25]);
  assert.deepEqual(parseVector('1 2 3'), [1, 2, 3]);
  assert.deepEqual(parseVector([1, 2]), [1, 2]);
});

test('rejects values that are not embeddings', () => {
  assert.equal(parseVector('hello'), null);
  assert.equal(parseVector('[1,abc]'), null);
  assert.equal(parseVector(''), null);
  assert.equal(parseVector(null), null);
  assert.equal(parseVector({ a: 1 }), null);
});

test('formats an embedding as a pgvector literal', () => {
  assert.equal(formatVectorLiteral([1, 2.5, -3]), '[1,2.5,-3]');
});

test('summarises dimensions, magnitude and range', () => {
  const s = summarizeVector([3, 4]);
  assert.equal(s.dimensions, 2);
  assert.equal(s.magnitude, 5);
  assert.equal(s.min, 3);
  assert.equal(s.max, 4);
  assert.deepEqual(s.preview, [3, 4]);
  assert.equal(summarizeVector(Array(20).fill(1)).preview.length, 8);
});

test('cosine similarity matches known values', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineDistance([1, 0], [1, 0]), 0);
});

test('cosine similarity is undefined for zero vectors and length mismatches', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), null);
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), null);
  assert.equal(cosineSimilarity([], []), null);
});

test('builds a cosine KNN query', () => {
  const sql = buildKnnQuery({ tableRef: '"public"."docs"', vectorColumn: 'embedding', reference: [1, 2] });
  assert.match(sql, /"embedding" <=> '\[1,2\]' AS cosine_distance/);
  assert.match(sql, /FROM "public"\."docs"/);
  assert.match(sql, /ORDER BY "embedding" <=> '\[1,2\]'/);
  assert.match(sql, /LIMIT 10;/);
  // Rows without an embedding can never be neighbours.
  assert.match(sql, /WHERE "embedding" IS NOT NULL/);
});

test('KNN query honours metric, limit and projection', () => {
  const sql = buildKnnQuery({
    tableRef: 'docs',
    vectorColumn: 'embedding',
    reference: [1],
    metric: 'l2',
    limit: 3,
    selectColumns: ['id', 'title'],
  });
  assert.match(sql, /SELECT "id", "title", "embedding" <-> '\[1\]' AS l2_distance/);
  assert.match(sql, /LIMIT 3;/);
  assert.match(buildKnnQuery({ tableRef: 't', vectorColumn: 'v', reference: [1], metric: 'inner_product' }), /<#>/);
});

test('KNN query rejects an empty or non-finite reference vector', () => {
  assert.throws(() => buildKnnQuery({ tableRef: 't', vectorColumn: 'v', reference: [] }), /required/i);
  assert.throws(() => buildKnnQuery({ tableRef: 't', vectorColumn: 'v', reference: [NaN] }), /finite/i);
  assert.throws(
    () => buildKnnQuery({ tableRef: 't', vectorColumn: 'v', reference: [Infinity] }),
    /finite/i
  );
});

test('a limit below one or fractional is clamped to a whole row count', () => {
  assert.match(buildKnnQuery({ tableRef: 't', vectorColumn: 'v', reference: [1], limit: 0 }), /LIMIT 1;/);
  assert.match(buildKnnQuery({ tableRef: 't', vectorColumn: 'v', reference: [1], limit: 2.7 }), /LIMIT 2;/);
});

test('quotes in identifiers cannot break out of the quoted name', () => {
  const sql = buildKnnQuery({ tableRef: 't', vectorColumn: 'we"ird', reference: [1] });
  assert.match(sql, /"we""ird"/);
});

test('builds a row-anchored KNN query that excludes the anchor row', () => {
  const sql = buildKnnQueryForRow({
    tableRef: '"docs"',
    vectorColumn: 'embedding',
    keyColumn: 'id',
    keyLiteral: '42',
    limit: 5,
  });
  assert.match(sql, /WITH anchor AS/);
  assert.match(sql, /SELECT "embedding" AS embedding FROM "docs" WHERE "id" = 42 LIMIT 1/);
  assert.match(sql, /"id" <> 42/);
  assert.match(sql, /ORDER BY "embedding" <=> anchor\.embedding/);
  assert.match(sql, /LIMIT 5;/);
});
