import type {
  DocumentByName,
  GenericDataModel,
  GenericDatabaseReader,
  TableNamesInDataModel
} from 'convex/server'
import type { GenericId } from 'convex/values'

/**
 * Type-safe wrapper for fetching multiple documents by ID.
 * Fetches all documents for the given IDs, returning null for missing documents.
 *
 * @example
 * ```typescript
 * const docs = await zGetAll(ctx.db, trainingIds)
 * // Type: Array<Doc<'training'> | null>
 * ```
 */
export async function zGetAll<
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel>
>(
  db: GenericDatabaseReader<DataModel>,
  ids: Array<GenericId<TableName>>
): Promise<Array<DocumentByName<DataModel, TableName> | null>> {
  return Promise.all(ids.map(id => db.get(id)))
}

/**
 * Type-safe wrapper for fetching multiple documents by ID with null filtering.
 * Fetches all documents and filters out null values, returning only existing documents.
 *
 * @example
 * ```typescript
 * const docs = await zGetAllNonNull(ctx.db, trainingIds)
 * // Type: Array<Doc<'training'>>
 * ```
 */
export async function zGetAllNonNull<
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel>
>(
  db: GenericDatabaseReader<DataModel>,
  ids: Array<GenericId<TableName>>
): Promise<Array<DocumentByName<DataModel, TableName>>> {
  const docs = await Promise.all(ids.map(id => db.get(id)))
  return docs.filter((doc): doc is Awaited<DocumentByName<DataModel, TableName>> => doc !== null)
}
