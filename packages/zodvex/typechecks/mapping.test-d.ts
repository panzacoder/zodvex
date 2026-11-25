import type { GenericId } from 'convex/values'
import { z } from 'zod'
import { zid } from '../src/internal/ids'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvexFields } from '../src/internal/mapping'
import { zx } from '../src/internal/zx'
import type { Equal, Expect } from './test-helpers'

// Check the consumer-facing value and presence types, without depending on
// Convex's internal validator class generic parameter layout.
const shape = {
  name: z.string(),
  age: z.number().optional(),
  withDefault: z.string().default('hello'),
  nullable: z.string().nullable(),
  userId: zid('users'),
  userIds: z.array(zid('users')),
  optionalUserIds: z.array(zid('users')).optional(),
  user: z.object({ id: zid('users'), name: z.string() }),
  teams: z
    .array(z.object({ name: z.string(), memberIds: z.array(zid('users')).optional() }))
    .optional(),
  status: z.union([z.literal('active'), z.literal('inactive')]),
  nullableStatus: z.union([z.literal('active'), z.literal('inactive')]).nullable(),
  role: z.enum(['admin', 'user', 'guest']),
  optionalRole: z.enum(['admin', 'user', 'guest']).optional(),
  literal: z.literal('user'),
  version: z.literal(1),
  optionalFlag: z.literal(true).optional(),
  tuple: z.tuple([z.string(), z.number()]),
  singleOptionalTuple: z.tuple([z.string().optional()]),
  restOnlyTuple: z.tuple([]).rest(z.string()),
  restTuple: z.tuple([z.string()], z.number()),
  emptyTuple: z.tuple([]),
  multiLiteral: z.literal(['a', 'b']),
  duplicateLiteral: z.literal(['a', 'a']),
  duplicateNullLiteral: z.literal([null, null]),
  mixedLiteral: z.literal(['a', null]),
  nullLiteral: z.literal(null)
}
const result = zodToConvexFields(shape)
type Fields = typeof result
type _MappedShape = Expect<Equal<Fields, ConvexValidatorFromZodFieldsAuto<typeof shape>>>
type _Name = Expect<Equal<Fields['name']['type'], string>>
type _Age = Expect<Equal<Fields['age']['type'], number | undefined>>
type _Required = Expect<Equal<Fields['name']['isOptional'], 'required'>>
type _Optional = Expect<Equal<Fields['age']['isOptional'], 'optional'>>
type _Default = Expect<Equal<Fields['withDefault']['isOptional'], 'optional'>>
type _Nullable = Expect<Equal<Fields['nullable']['type'], string | null>>
type _NullableRequired = Expect<Equal<Fields['nullable']['isOptional'], 'required'>>
type _Id = Expect<Equal<Fields['userId']['type'], GenericId<'users'>>>
type _Ids = Expect<Equal<Fields['userIds']['type'], GenericId<'users'>[]>>
type _OptionalIds = Expect<
  Equal<Fields['optionalUserIds']['type'], GenericId<'users'>[] | undefined>
>
type _NestedId = Expect<Equal<Fields['user']['type']['id'], GenericId<'users'>>>
type _NestedOptionalIds = Expect<
  Equal<NonNullable<Fields['teams']['type']>[number]['memberIds'], GenericId<'users'>[] | undefined>
>
type _Union = Expect<Equal<Fields['status']['type'], 'active' | 'inactive'>>
type _NullableUnion = Expect<Equal<Fields['nullableStatus']['type'], 'active' | 'inactive' | null>>
type _Enum = Expect<Equal<Fields['role']['type'], 'admin' | 'user' | 'guest'>>
type _OptionalEnum = Expect<
  Equal<Fields['optionalRole']['type'], 'admin' | 'user' | 'guest' | undefined>
>
type _Literal = Expect<Equal<Fields['literal']['type'], 'user'>>
type _NumberLiteral = Expect<Equal<Fields['version']['type'], 1>>
type _OptionalLiteral = Expect<Equal<Fields['optionalFlag']['type'], true | undefined>>
type _Tuple = Expect<Equal<Fields['tuple']['type'], [string, number]>>
type _TupleElement = Expect<Equal<Fields['tuple']['element']['type'], string | number>>
type _TupleElementKind = Expect<Equal<Fields['tuple']['element']['kind'], 'union'>>
type _SingleOptionalTupleElement = Expect<
  Equal<Fields['singleOptionalTuple']['element']['type'], string>
>
type _SingleOptionalTupleElementKind = Expect<
  Equal<Fields['singleOptionalTuple']['element']['kind'], 'string'>
>
type _RestTupleElement = Expect<Equal<Fields['restTuple']['element']['type'], string | number>>
type _EmptyTupleElement = Expect<Equal<Fields['emptyTuple']['element']['kind'], 'any'>>
type _MultiLiteral = Expect<Equal<Fields['multiLiteral']['type'], 'a' | 'b'>>
type _MultiLiteralKind = Expect<Equal<Fields['multiLiteral']['kind'], 'union'>>
type _MultiLiteralMembers = Expect<
  Equal<Fields['multiLiteral']['members'][number]['type'], 'a' | 'b'>
>
type _MixedLiteral = Expect<Equal<Fields['mixedLiteral']['type'], 'a' | null>>
type _MixedLiteralKind = Expect<Equal<Fields['mixedLiteral']['kind'], 'union'>>
type _MixedLiteralMembers = Expect<
  Equal<Fields['mixedLiteral']['members'][number]['kind'], 'literal' | 'null'>
>
type _NullLiteral = Expect<Equal<Fields['nullLiteral']['type'], null>>

type _RestOnlyTupleElementKind = Expect<Equal<Fields['restOnlyTuple']['element']['kind'], 'string'>>
type _RestOnlyTupleElementType = Expect<Equal<Fields['restOnlyTuple']['element']['type'], string>>

const dateCodec = z.codec(z.string(), z.date(), {
  decode: value => new Date(value),
  encode: value => value.toISOString()
})
const codecTuples = zodToConvexFields({
  fixed: z.tuple([dateCodec, z.number()]),
  rest: z.tuple([z.boolean()], dateCodec),
  optional: z.tuple([dateCodec.optional()]),
  nested: z.object({ pairs: z.array(z.tuple([dateCodec])) }),
  nullable: z.tuple([dateCodec]).nullable(),
  branded: z.tuple([zx.date()])
})
type _CodecTupleWire = Expect<Equal<typeof codecTuples.fixed.type, [string, number]>>
type _CodecTupleElement = Expect<Equal<typeof codecTuples.fixed.element.type, string | number>>
type _CodecRestWire = Expect<Equal<typeof codecTuples.rest.type, [boolean, ...string[]]>>
type _CodecOptionalWire = Expect<Equal<typeof codecTuples.optional.type, [string?]>>
type _CodecNestedWire = Expect<Equal<typeof codecTuples.nested.type.pairs, [string][]>>
type _CodecNullableWire = Expect<Equal<typeof codecTuples.nullable.type, [string] | null>>
type _BrandedCodecTupleWire = Expect<Equal<typeof codecTuples.branded.type, [number]>>

type _DuplicateLiteralKind = Expect<Equal<Fields['duplicateLiteral']['kind'], 'literal'>>
type _DuplicateLiteralValue = Expect<Equal<Fields['duplicateLiteral']['value'], 'a'>>
type _DuplicateNullLiteralKind = Expect<Equal<Fields['duplicateNullLiteral']['kind'], 'null'>>
