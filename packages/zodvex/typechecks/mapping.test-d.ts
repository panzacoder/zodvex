import type { GenericId } from 'convex/values'
import { z } from 'zod'
import { zid } from '../src/internal/ids'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvexFields } from '../src/internal/mapping'
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
  optionalFlag: z.literal(true).optional()
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
