import { z } from 'zod'
import { defineZodModel } from 'zodvex/core'

export const OkModel = defineZodModel('oks', { name: z.string() })
