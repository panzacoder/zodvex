export type Id<TableName extends string> = string & { __tableName: TableName }
export type Doc<TableName extends string> = any
