import { z } from 'zod'
import { $ZodType, type input as zinput } from '../zod-core'

export function returnsAs<R extends $ZodType>() {
  return <T extends zinput<R>>(v: T) => v
}

export function zPaginated<T extends $ZodType>(item: T) {
  return z.object({
    page: z.array(item),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
    pageStatus: z.enum(['SplitRecommended', 'SplitRequired']).nullable().optional()
  })
}
