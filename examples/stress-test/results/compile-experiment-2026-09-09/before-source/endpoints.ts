import { z } from 'zod'
import { zx } from 'zodvex'
import { zq } from './functions'
import { Ticket, ticketCodec } from './values'

export const plain = zq({ args: { value: z.string() }, returns: z.string(), handler: (_ctx, { value }) => value })
export const dateArg = zq({ args: { value: zx.date() }, returns: z.boolean(), handler: (_ctx, { value }) => value instanceof Date })
export const classArg = zq({ args: { value: ticketCodec }, returns: z.boolean(), handler: (_ctx, { value }) => value instanceof Ticket })
export const dateReturn = zq({ args: {}, returns: zx.date(), handler: () => new Date(1000) })
export const classReturn = zq({ args: {}, returns: ticketCodec, handler: () => new Ticket('ticket-1') })
export const refineArg = zq({ args: { value: z.string().refine(value => value.startsWith('ticket-')) }, returns: z.string(), handler: (_ctx, { value }) => value })
export const defaultArg = zq({ args: { value: z.string().default('filled') }, returns: z.string(), handler: (_ctx, { value }) => value })
