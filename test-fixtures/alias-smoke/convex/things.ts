// The alias import is the point of this fixture: under Node, discovery can
// only load this module if the loader hook replays tsconfig paths (#99).
import { titleField } from '@/convex/lib/fields'
import { z } from 'zod'
import { defineZodModel } from 'zodvex/core'

export const ThingModel = defineZodModel('things', {
  title: titleField,
  count: z.number()
})
