import { z } from 'zod'
import {
  defineZodModel,
  type FieldPaths,
  type FullZodModelSchemas,
  type ModelFieldPaths,
  type ModelSchemas,
  type SearchIndexConfig,
  type UnionModelSchemas,
  type VectorIndexConfig,
  type ZodModel as SharedZodModel
} from '../model'
import type { $ZodShape, $ZodType } from '../zod-core'

type DefaultFullModelSchemas<
  Name extends string,
  Fields extends $ZodShape,
  InsertSchema extends $ZodType
> = InsertSchema extends z.ZodObject<Fields>
  ? FullZodModelSchemas<Name, Fields>
  : UnionModelSchemas<Name, InsertSchema>

export type ZodModel<
  Name extends string = string,
  Fields extends $ZodShape = $ZodShape,
  InsertSchema extends $ZodType = z.ZodObject<Fields>,
  Schemas extends ModelSchemas = DefaultFullModelSchemas<Name, Fields, InsertSchema>,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = SharedZodModel<
  Name,
  Fields,
  InsertSchema,
  Schemas,
  Indexes,
  SearchIndexes,
  VectorIndexes
>

export {
  defineZodModel,
  type FieldPaths,
  type FullZodModelSchemas,
  type ModelFieldPaths,
  type ModelSchemas,
  type SearchIndexConfig,
  type UnionModelSchemas,
  type VectorIndexConfig
}
