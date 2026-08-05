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
}
