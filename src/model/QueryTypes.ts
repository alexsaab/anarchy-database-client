export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  defaultValue?: string;
  comment?: string;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type?: 'table' | 'view' | 'collection' | 'bucket' | string;
  comment?: string;
  /** Elasticsearch: alias names pointing at this index. */
  aliases?: string[];
}

/** Elasticsearch alias and the concrete indices behind it. */
export interface AliasInfo {
  name: string;
  indices: string[];
  /** Index this alias writes to, when several are behind it. */
  writeIndex?: string;
  /** True when the alias narrows its indices with a filter. */
  filtered?: boolean;
}

export interface QueryResult {
  rows: any[];
  fields: ColumnInfo[];
  affectedRows?: number;
  costTimeMs: number;
  totalCount?: number;
}

export interface PageParams {
  page: number;
  pageSize: number;
  filterSql?: string;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
  /**
   * Free-text search applied by the server across all columns, so matches on
   * pages other than the current one are still found.
   */
  searchTerm?: string;
}
