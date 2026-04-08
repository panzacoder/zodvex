import { z } from 'zod'
import { defineZodModel as _defineZodModel } from '../model'
import type { AddSystemFieldsToUnion } from '../schemaHelpers'
import { $ZodArray, type $ZodShape, $ZodType, type input as zinput } from '../zod-core'
import type { ZxId } from './zx'

export type FieldPaths<T> = T extends any[]
  ? never
  : T extends Record<string, any>
    ? T extends T
      ? {
          [K in keyof T & string]:
            | K
            | (NonNullable<T[K]> extends any[]
                ? never
                : NonNullable<T[K]> extends Record<string, any>
                  ? `${K}.${FieldPaths<NonNullable<T[K]>>}`
                  : never)
        }[keyof T & string]
      : never
    : never

export type ModelFieldPaths<InsertSchema extends $ZodType> =
  | FieldPaths<zinput<InsertSchema>>
  | '_creationTime'

export type SearchIndexConfig = {
  searchField: string
  filterFields?: string[]
}

export type VectorIndexConfig = {
  vectorField: string
  dimensions: number
  filterFields?: string[]
}

export type ModelSchemas = {
  readonly doc: $ZodType
  readonly base: $ZodType
  readonly insert: $ZodType
  readonly update: $ZodType
  readonly docArray: $ZodType
  readonly paginatedDoc: $ZodType
}

export type UnionModelSchemas<Name extends string, Schema extends $ZodType> = {
  readonly doc: AddSystemFieldsToUnion<Name, Schema>
  readonly base: Schema
  readonly insert: Schema
  readonly update: $ZodType
  readonly docArray: $ZodArray<AddSystemFieldsToUnion<Name, Schema>>
  readonly paginatedDoc: $ZodType
}

type FullUpdateShape<Name extends string, Fields extends $ZodShape> = {
  _id: ZxId<Name>
  _creationTime: z.ZodOptional<z.ZodNumber>
} & { [K in keyof Fields]: z.ZodOptional<Fields[K]> }

type FullDocShape<Name extends string, Fields extends $ZodShape> = Fields & {
  _id: ZxId<Name>
  _creationTime: z.ZodNumber
}

type FullPaginatedShape<Name extends string, Fields extends $ZodShape> = {
  page: z.ZodArray<z.ZodObject<FullDocShape<Name, Fields>>>
  isDone: z.ZodBoolean
  continueCursor: z.ZodOptional<z.ZodNullable<z.ZodString>>
}

export type FullZodModelSchemas<Name extends string, Fields extends $ZodShape> = {
  readonly doc: z.ZodObject<FullDocShape<Name, Fields>>
  readonly base: z.ZodObject<Fields>
  readonly insert: z.ZodObject<Fields>
  readonly update: z.ZodObject<FullUpdateShape<Name, Fields>>
  readonly docArray: z.ZodArray<z.ZodObject<FullDocShape<Name, Fields>>>
  readonly paginatedDoc: z.ZodObject<FullPaginatedShape<Name, Fields>>
}

type DefaultFullModelSchemas<
  Name extends string,
  Fields extends $ZodShape,
  InsertSchema extends $ZodType
> =
  InsertSchema extends z.ZodObject<Fields>
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
> = {
  readonly name: Name
  readonly fields: Fields
  readonly schema: Schemas
  readonly indexes: Indexes
  readonly searchIndexes: SearchIndexes
  readonly vectorIndexes: VectorIndexes

  index<
    IndexName extends string,
    First extends ModelFieldPaths<InsertSchema>,
    Rest extends ModelFieldPaths<InsertSchema>[]
  >(
    name: IndexName,
    fields: readonly [First, ...Rest]
  ): ZodModel<
    Name,
    Fields,
    InsertSchema,
    Schemas,
    Indexes & Record<IndexName, readonly [First, ...Rest, '_creationTime']>,
    SearchIndexes,
    VectorIndexes
  >

  searchIndex<IndexName extends string>(
    name: IndexName,
    config: SearchIndexConfig
  ): ZodModel<
    Name,
    Fields,
    InsertSchema,
    Schemas,
    Indexes,
    SearchIndexes & Record<IndexName, SearchIndexConfig>,
    VectorIndexes
  >

  vectorIndex<IndexName extends string>(
    name: IndexName,
    config: VectorIndexConfig
  ): ZodModel<
    Name,
    Fields,
    InsertSchema,
    Schemas,
    Indexes,
    SearchIndexes,
    VectorIndexes & Record<IndexName, VectorIndexConfig>
  >
}

export function defineZodModel<Name extends string, Fields extends $ZodShape>(
  name: Name,
  fields: Fields
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, Fields, z.ZodObject<Fields>, FullZodModelSchemas<Name, Fields>, {}, {}, {}>

export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, $ZodShape, Schema, UnionModelSchemas<Name, Schema>, {}, {}, {}>

export function defineZodModel<Name extends string>(
  name: Name,
  fieldsOrSchema: $ZodShape | $ZodType
): any {
  if (fieldsOrSchema instanceof $ZodType) {
    return _defineZodModel(name, fieldsOrSchema)
  }
  return _defineZodModel(name, fieldsOrSchema)
}
