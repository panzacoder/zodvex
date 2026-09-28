import { } from './functions'
import { Ticket } from "./values"
import { query } from "./_generated/server";
import { v } from "convex/values";

export const plain = query({ args: { value: v.string() }, returns: v.string(), handler: (_ctx, { value }) => value })
export const dateArg = query({ args: { value: v.float64() }, returns: v.boolean(), handler: (_ctx, { value }) => value instanceof Date })
export const classArg = query({ args: { value: v.string() }, returns: v.boolean(), handler: (_ctx, { value }) => value instanceof Ticket })
export const dateReturn = query({ args: {}, returns: v.float64(), handler: () => new Date(1000) })
export const classReturn = query({ args: {}, returns: v.string(), handler: () => new Ticket('ticket-1') })
export const refineArg = query({ args: { value: v.string() }, returns: v.string(), handler: (_ctx, { value }) => value })
export const defaultArg = query({ args: { value: v.optional(v.string()) }, returns: v.string(), handler: (_ctx, { value }) => value })
