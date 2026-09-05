/**
 * Placeholder discovery and substitution for ad-hoc queries typed in the editor
 * or the query console.
 *
 * Placeholders only mean something outside of string literals and comments, so
 * this scans the statement character by character rather than running a regex
 * over the raw text -- `SELECT ':not_a_param'` must stay untouched.
 */

export type ParameterStyle = 'named' | 'numbered' | 'anonymous';

export interface QueryParameter {
  /** Unique key used to collect a value: `:id` -> `id`, `$1` -> `1`, the 2nd `?` -> `2`. */
  key: string;
  /** The placeholder exactly as it appears in the statement. */
  token: string;
  style: ParameterStyle;
  /** 0-based offsets of every occurrence, in order. */
  offsets: number[];
}

/** A literal that must be substituted verbatim rather than quoted. */
const UNQUOTED = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)$/i;

interface Token {
  key: string;
  token: string;
  style: ParameterStyle;
  offset: number;
}

/**
 * Walks the statement and yields every placeholder occurrence, skipping string
 * literals, quoted identifiers, comments and dollar-quoted bodies.
 */
function scan(sql: string): Token[] {
  const found: Token[] = [];
  let anonymousCount = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }

    // /* block comment */ -- nesting is what PostgreSQL does, and it is harmless elsewhere
    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // 'string literal' with '' escaping, "quoted identifier", `backticked identifier`
    if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\' && (ch === "'" || ch === '`')) {
          i += 2; // MySQL-style backslash escape
          continue;
        }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2; // doubled quote is an escaped quote
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '$') {
      // $tag$ ... $tag$ dollar-quoted body (PL/pgSQL function bodies)
      const dollarQuote = /^\$[a-zA-Z_][a-zA-Z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (dollarQuote) {
        const tag = dollarQuote[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? sql.length : close + tag.length;
        continue;
      }
      // $1, $2 -- numbered placeholder
      const numbered = /^\$(\d+)/.exec(sql.slice(i));
      if (numbered) {
        found.push({ key: numbered[1], token: numbered[0], style: 'numbered', offset: i });
        i += numbered[0].length;
        continue;
      }
      i++;
      continue;
    }

    if (ch === ':') {
      // `::type` is a PostgreSQL cast, and `:=` an assignment -- neither is a placeholder.
      if (next === ':') {
        i += 2;
        continue;
      }
      const named = /^:([a-zA-Z_][a-zA-Z0-9_]*)/.exec(sql.slice(i));
      if (named) {
        found.push({ key: named[1], token: named[0], style: 'named', offset: i });
        i += named[0].length;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '@') {
      // @@VERSION and friends are server globals, not placeholders.
      if (next === '@') {
        i += 2;
        continue;
      }
      const named = /^@([a-zA-Z_][a-zA-Z0-9_]*)/.exec(sql.slice(i));
      if (named) {
        found.push({ key: named[1], token: named[0], style: 'named', offset: i });
        i += named[0].length;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '?') {
      // Postgres JSON operators (?, ?|, ?&) would false-positive here, but they
      // are rare next to `?` placeholders and cannot be told apart lexically.
      anonymousCount++;
      found.push({ key: String(anonymousCount), token: '?', style: 'anonymous', offset: i });
      i++;
      continue;
    }

    i++;
  }

  return found;
}

/**
 * Collects the distinct placeholders in a statement, in first-appearance order.
 * A named placeholder repeated several times is one parameter with several
 * offsets; every `?` is its own parameter because it has no name to share.
 */
export function extractParameters(sql: string): QueryParameter[] {
  const byKey = new Map<string, QueryParameter>();

  for (const tok of scan(sql)) {
    // `:id` and `$1` live in separate namespaces; prefix so they cannot collide.
    const uniqueKey = `${tok.style}:${tok.key}`;
    const existing = byKey.get(uniqueKey);
    if (existing) {
      existing.offsets.push(tok.offset);
    } else {
      byKey.set(uniqueKey, { key: tok.key, token: tok.token, style: tok.style, offsets: [tok.offset] });
    }
  }

  return [...byKey.values()];
}

/** True when the statement has at least one placeholder to fill in. */
export function hasParameters(sql: string): boolean {
  return extractParameters(sql).length > 0;
}

/**
 * Renders a user-typed value as a SQL literal. Numbers, booleans and NULL go in
 * bare; everything else is single-quoted with embedded quotes doubled, so a
 * value can never break out of its literal.
 */
export function formatLiteral(raw: string): string {
  const value = raw.trim();
  if (value === '') return "''";
  if (UNQUOTED.test(value)) {
    return value.toLowerCase() === 'null' ? 'NULL' : value;
  }
  // An explicitly quoted value is passed through as the user wrote it.
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Substitutes collected values into the statement. Offsets are replaced from the
 * end backwards so earlier ones stay valid as the string changes length.
 */
export function applyParameters(sql: string, values: Map<string, string>): string {
  const replacements: { offset: number; length: number; text: string }[] = [];

  for (const param of extractParameters(sql)) {
    const uniqueKey = `${param.style}:${param.key}`;
    const raw = values.has(uniqueKey) ? values.get(uniqueKey) : values.get(param.key);
    if (raw === undefined) continue;
    const literal = formatLiteral(raw);
    for (const offset of param.offsets) {
      replacements.push({ offset, length: param.token.length, text: literal });
    }
  }

  replacements.sort((a, b) => b.offset - a.offset);

  let result = sql;
  for (const r of replacements) {
    result = result.slice(0, r.offset) + r.text + result.slice(r.offset + r.length);
  }
  return result;
}

/** Human-readable label for a placeholder, used in prompts. */
export function describeParameter(param: QueryParameter): string {
  if (param.style === 'anonymous') return `? #${param.key}`;
  return param.token;
}
