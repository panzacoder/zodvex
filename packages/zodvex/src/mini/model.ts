import type {
  ZodMiniArray,
  ZodMiniBoolean,
  ZodMiniDiscriminatedUnion,
  ZodMiniNullable,
  ZodMiniNumber,
  ZodMiniObject,
  ZodMiniOptional,
  ZodMiniString,
  ZodMiniType,
  ZodMiniUnion
} from 'zod/mini'
import { defineZodModel as _defineZodModel } from '../model'
import { type $strip, type $ZodShape, $ZodType, type input as zinput } from '../zod-core'
import type { ZxMiniId } from './zx'

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

type MiniSystemFields<Name extends string> = {
  _id: ZxMiniId<Name>
  _creationTime: ZodMiniNumber
}

type MapSystemFieldsMini<Name extends string, Options extends readonly $ZodType[]> = {
  [K in keyof Options]: Options[K] extends ZodMiniObject<
    infer Shape extends $ZodShape,
    infer Config extends $strip
  >
    ? ZodMiniObject<Shape & MiniSystemFields<Name>, Config>
    : Options[K]
}

export type AddSystemFieldsToMiniUnion<Name extends string, Schema extends $ZodType> =
  Schema extends ZodMiniObject<infer Shape extends $ZodShape, infer Config extends $strip>
    ? ZodMiniObject<Shape & MiniSystemFields<Name>, Config>
    : Schema extends ZodMiniUnion<infer Options extends readonly $ZodType[]>
      ? ZodMiniUnion<MapSystemFieldsMini<Name, Options>>
      : Schema extends ZodMiniDiscriminatedUnion<
            infer Options extends readonly $ZodType[],
            infer Disc extends string
          >
        ? ZodMiniDiscriminatedUnion<MapSystemFieldsMini<Name, Options>, Disc>
        : Schema

export type MiniModelSchemas<Name extends string, Fields extends $ZodShape> = {
  readonly doc: ZodMiniObject<
    Fields & { _id: ZxMiniId<Name>; _creationTime: ZodMiniNumber },
    $strip
  >
  readonly base: ZodMiniObject<Fields, $strip>
  readonly insert: ZodMiniObject<Fields, $strip>
  readonly update: ZodMiniObject<
    { _id: ZxMiniId<Name>; _creationTime: ZodMiniOptional<ZodMiniNumber> } & {
      [K in keyof Fields]: ZodMiniOptional<Fields[K]>
    },
    $strip
  >
  readonly docArray: ZodMiniArray<
    ZodMiniObject<Fields & { _id: ZxMiniId<Name>; _creationTime: ZodMiniNumber }, $strip>
  >
  readonly paginatedDoc: ZodMiniObject<
    {
      page: ZodMiniArray<
        ZodMiniObject<Fields & { _id: ZxMiniId<Name>; _creationTime: ZodMiniNumber }, $strip>
      >
      isDone: ZodMiniBoolean
      continueCursor: ZodMiniOptional<ZodMiniNullable<ZodMiniString>>
    },
    $strip
  >
}

export type MiniUnionModelSchemas<Name extends string, Schema extends $ZodType> = {
  readonly doc: AddSystemFieldsToMiniUnion<Name, Schema>
  readonly base: Schema
  readonly insert: Schema
  readonly update: ZodMiniType
  readonly docArray: ZodMiniArray<AddSystemFieldsToMiniUnion<Name, Schema>>
  readonly paginatedDoc: ZodMiniType
}

type DefaultMiniModelSchemas<
  Name extends string,
  Fields extends $ZodShape,
  InsertSchema extends $ZodType
> =
  InsertSchema extends ZodMiniObject<Fields, $strip>
    ? MiniModelSchemas<Name, Fields>
    : MiniUnionModelSchemas<Name, InsertSchema>

export type ZodModel<
  Name extends string = string,
  Fields extends $ZodShape = $ZodShape,
  InsertSchema extends $ZodType = ZodMiniObject<Fields, $strip>,
  Schemas extends ModelSchemas = DefaultMiniModelSchemas<Name, Fields, InsertSchema>,
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
): ZodModel<Name, Fields, ZodMiniObject<Fields, $strip>, MiniModelSchemas<Name, Fields>, {}, {}, {}>

export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, $ZodShape, Schema, MiniUnionModelSchemas<Name, Schema>, {}, {}, {}>

export function defineZodModel<Name extends string>(
  name: Name,
  fieldsOrSchema: $ZodShape | $ZodType
): any {
  if (fieldsOrSchema instanceof $ZodType) {
    return _defineZodModel(name, fieldsOrSchema)
  }
  return _defineZodModel(name, fieldsOrSchema)
}
