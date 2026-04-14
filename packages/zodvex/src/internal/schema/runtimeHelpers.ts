import { z } from 'zod'
import { $ZodNullable, $ZodOptional, $ZodType, type input as zinput } from '../zod-core'

export function returnsAs<R extends $ZodType>() {
  return <T extends zinput<R>>(v: T) => v
}

/** Wrap in .nullable().optional() using core constructors for zod-mini compat. */
function nullableOptional(schema: $ZodType): $ZodType {
  return new $ZodOptional({
    type: 'optional',
    innerType: new $ZodNullable({ type: 'nullable', innerType: schema })
  }) as any
}

export function zPaginated<T extends $ZodType>(item: T) {
  return z.object({
    page: z.array(item),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: nullableOptional(z.string()),
    pageStatus: nullableOptional(z.enum(['SplitRecommended', 'SplitRequired']))
  })
}
