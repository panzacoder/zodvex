// Mock Convex query and mutation builders for testing
// Note: These are simplified mocks for testing zodvex wrappers.
// They use `any` types extensively to avoid importing the full Convex runtime.
// These are not production-ready implementations.
import type { RegisteredQuery, RegisteredMutation } from 'convex/server'

export const query = ((fn: any) => ({
  isConvexFunction: true,
  isQuery: true,
  isPublic: true,
  ...fn
})) as <Args, Returns>(
  fn: { args: Args; returns?: any; handler: (ctx: any, args: any) => Returns }
) => RegisteredQuery<'public', Args, Returns>

export const mutation = ((fn: any) => ({
  isConvexFunction: true,
  isMutation: true,
  isPublic: true,
  ...fn
})) as <Args, Returns>(
  fn: { args: Args; returns?: any; handler: (ctx: any, args: any) => Returns }
) => RegisteredMutation<'public', Args, Returns>

export const internalQuery = ((fn: any) => ({
  isConvexFunction: true,
  isQuery: true,
  isInternal: true,
  ...fn
})) as <Args, Returns>(
  fn: { args: Args; returns?: any; handler: (ctx: any, args: any) => Returns }
) => RegisteredQuery<'internal', Args, Returns>

export const internalMutation = ((fn: any) => ({
  isConvexFunction: true,
  isMutation: true,
  isInternal: true,
  ...fn
})) as <Args, Returns>(
  fn: { args: Args; returns?: any; handler: (ctx: any, args: any) => Returns }
) => RegisteredMutation<'internal', Args, Returns>