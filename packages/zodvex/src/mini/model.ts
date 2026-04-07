import {
  defineZodModel as _defineZodModel,
  type UnionModelSchemas as _UnionModelSchemas,
  type ZodModel as _ZodModel
} from '../model'
import type {
  $strip,
  $ZodArray,
  $ZodBoolean,
  $ZodNullable,
  $ZodNumber,
  $ZodObject,
  $ZodOptional,
  $ZodShape,
  $ZodString,
  $ZodType
} from '../zod-core'
import type { ZxMiniId } from './zx'

/** Mini-typed schema bundle for ZodModel from zodvex/mini */
export type MiniModelSchemas<Name extends string, Fields extends $ZodShape> = {
  readonly doc: $ZodObject<Fields & { _id: ZxMiniId<Name>; _creationTime: $ZodNumber }, $strip>
  readonly base: $ZodObject<Fields, $strip>
  readonly insert: $ZodObject<Fields, $strip>
  readonly update: $ZodObject<
    { _id: ZxMiniId<Name>; _creationTime: $ZodOptional<$ZodNumber> } & {
      [K in keyof Fields]: $ZodOptional<Fields[K]>
    },
    $strip
  >
  readonly docArray: $ZodArray<
    $ZodObject<Fields & { _id: ZxMiniId<Name>; _creationTime: $ZodNumber }, $strip>
  >
  readonly paginatedDoc: $ZodObject<
    {
      page: $ZodArray<
        $ZodObject<Fields & { _id: ZxMiniId<Name>; _creationTime: $ZodNumber }, $strip>
      >
      isDone: $ZodBoolean
      continueCursor: $ZodOptional<$ZodNullable<$ZodString>>
    },
    $strip
  >
}

/** Mini-typed defineZodModel surface backed by the shared model runtime. */
export const defineZodModel: {
  <Name extends string, Fields extends $ZodShape>(
    name: Name,
    fields: Fields
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, Fields, $ZodObject<Fields, $strip>, MiniModelSchemas<Name, Fields>, {}, {}, {}>
  <Name extends string, Schema extends $ZodType>(
    name: Name,
    schema: Schema
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, $ZodShape, Schema, _UnionModelSchemas<Name, Schema>, {}, {}, {}>
} = _defineZodModel as any
