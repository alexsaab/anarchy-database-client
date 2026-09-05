import { ColumnInfo } from '../model/QueryTypes.js';

/**
 * Helpers for inspecting and querying pgvector columns.
 *
 * pgvector exposes similarity as operators rather than functions, so a nearest
 * neighbour search is an ORDER BY over `column <=> 'literal'`. Everything here
 * is pure text/number work; running the statement is the caller's job.
 */

export type VectorMetric = 'cosine' | 'l2' | 'inner_product';

/** pgvector operator for each metric. */
const METRIC_OPERATORS: Record<VectorMetric, string> = {
  cosine: '<=>',
  l2: '<->',
  inner_product: '<#>',
};

/** What each operator actually returns, for labelling the result column. */
const METRIC_LABELS: Record<VectorMetric, string> = {
  cosine: 'cosine_distance',
  l2: 'l2_distance',
  inner_product: 'inner_product',
};

export interface VectorSummary {
  dimensions: number;
  /** Euclidean length; 1.0 means the embedding is already normalised. */
  magnitude: number;
  min: number;
  max: number;
  /** First few components, for a compact preview in the grid. */
  preview: number[];
}

/** True for pgvector column types: `vector`, `vector(1536)`, `halfvec`, `sparsevec`. */
export function isVectorColumn(column: Pick<ColumnInfo, 'type'>): boolean {
  return /^\s*(halfvec|sparsevec|vector)\s*(\(\s*\d+\s*\))?\s*$/i.test(column.type || '');
}

/** Declared dimension count, when the column type pins one: `vector(1536)` -> 1536. */
export function declaredDimensions(column: Pick<ColumnInfo, 'type'>): number | undefined {
  const m = /\(\s*(\d+)\s*\)/.exec(column.type || '');
  return m ? Number(m[1]) : undefined;
}

/**
 * Reads an embedding out of a cell. pgvector comes back as the string
 * `[0.1,0.2]` over most drivers and as a real array over others; JSON arrays
 * and whitespace-separated numbers are accepted too. Returns null when the
 * value is not an embedding.
 */
export function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const nums = value.map(Number);
    return nums.every((n) => Number.isFinite(n)) ? nums : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim().replace(/^\[|\]$/g, '').trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[,\s]+/).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.length === 0 || !nums.every((n) => Number.isFinite(n))) return null;
  return nums;
}

/** Renders an embedding as a pgvector literal: `[1,2,3]`. */
export function formatVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/** Dimensions, magnitude and range — what you want to see before running a search. */
export function summarizeVector(vector: number[]): VectorSummary {
  const magnitude = Math.sqrt(vector.reduce((acc, n) => acc + n * n, 0));
  return {
    dimensions: vector.length,
    magnitude,
    min: vector.length ? Math.min(...vector) : 0,
    max: vector.length ? Math.max(...vector) : 0,
    preview: vector.slice(0, 8),
  };
}

/**
 * Cosine similarity in [-1, 1]. Returns null for mismatched lengths or a zero
 * vector, where the measure is undefined rather than zero.
 */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Cosine distance, the quantity pgvector's `<=>` returns. */
export function cosineDistance(a: number[], b: number[]): number | null {
  const similarity = cosineSimilarity(a, b);
  return similarity === null ? null : 1 - similarity;
}

export interface KnnQueryOptions {
  /** Table reference, already quoted/schema-qualified by the caller. */
  tableRef: string;
  vectorColumn: string;
  /** The embedding to search near. */
  reference: number[];
  limit?: number;
  metric?: VectorMetric;
  /** Columns to select alongside the distance; defaults to every column. */
  selectColumns?: string[];
}

/**
 * Builds a k-nearest-neighbour query. The reference vector is rendered as a
 * literal because pgvector's index-backed operators need it inline, so only
 * finite numbers are allowed through -- nothing user-typed reaches the SQL.
 */
export function buildKnnQuery(options: KnnQueryOptions): string {
  const { tableRef, vectorColumn, reference } = options;
  if (!reference.length) {
    throw new Error('A reference vector is required.');
  }
  if (!reference.every((n) => Number.isFinite(n))) {
    throw new Error('A reference vector must contain finite numbers only.');
  }

  const metric: VectorMetric = options.metric || 'cosine';
  const operator = METRIC_OPERATORS[metric];
  const label = METRIC_LABELS[metric];
  const limit = Math.max(1, Math.floor(options.limit ?? 10));
  const quotedColumn = `"${vectorColumn.replace(/"/g, '""')}"`;
  const projection = options.selectColumns?.length
    ? options.selectColumns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')
    : '*';
  const literal = `'${formatVectorLiteral(reference)}'`;

  return (
    `SELECT ${projection}, ${quotedColumn} ${operator} ${literal} AS ${label}\n` +
    `FROM ${tableRef}\n` +
    `WHERE ${quotedColumn} IS NOT NULL\n` +
    `ORDER BY ${quotedColumn} ${operator} ${literal}\n` +
    `LIMIT ${limit};`
  );
}

/**
 * Builds a KNN query anchored on an existing row, so you can ask "what else
 * looks like this record" without pasting an embedding.
 */
export function buildKnnQueryForRow(
  options: Omit<KnnQueryOptions, 'reference'> & { keyColumn: string; keyLiteral: string }
): string {
  const metric: VectorMetric = options.metric || 'cosine';
  const operator = METRIC_OPERATORS[metric];
  const label = METRIC_LABELS[metric];
  const limit = Math.max(1, Math.floor(options.limit ?? 10));
  const quotedColumn = `"${options.vectorColumn.replace(/"/g, '""')}"`;
  const quotedKey = `"${options.keyColumn.replace(/"/g, '""')}"`;
  const projection = options.selectColumns?.length
    ? options.selectColumns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')
    : '*';

  return (
    `WITH anchor AS (\n` +
    `  SELECT ${quotedColumn} AS embedding FROM ${options.tableRef} WHERE ${quotedKey} = ${options.keyLiteral} LIMIT 1\n` +
    `)\n` +
    `SELECT ${projection}, ${quotedColumn} ${operator} anchor.embedding AS ${label}\n` +
    `FROM ${options.tableRef}, anchor\n` +
    `WHERE ${quotedColumn} IS NOT NULL AND ${quotedKey} <> ${options.keyLiteral}\n` +
    `ORDER BY ${quotedColumn} ${operator} anchor.embedding\n` +
    `LIMIT ${limit};`
  );
}
