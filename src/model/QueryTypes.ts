export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  defaultValue?: string | null;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type?: 'table' | 'view';
  comment?: string;
}

export interface QueryResult {
  rows: Record<string, any>[];
  fields: ColumnInfo[];
  affectedRows?: number;
  costTimeMs: number;
  totalCount?: number;
}

export interface PageParams {
  page: number;
  pageSize: number;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
  filterSql?: string;
}
