/**
 * Minimal stubs that mimic the shape of Convex's types and builders.
 * Fixture files import from this module so that ts-morph can resolve types
 * without needing a real `convex` install.
 */

export type Id<T extends string> = string & { readonly __tableName: T }

export type GenericId<T extends string> = Id<T>

export type DatabaseReader = {
  query: (tableName: string) => {
    collect: () => Promise<any[]>
    first: () => Promise<any | null>
    unique: () => Promise<any>
    withIndex: (name: string, fn: (q: any) => any) => any
  }
  get: {
    <T extends string>(id: Id<T>): Promise<any>
    <T extends string>(tableName: T, id: Id<T>): Promise<any>
  }
  normalizeId: (tableName: string, id: string) => string | null
  system: {
    query: (tableName: string) => any
  }
}

export type DatabaseWriter = DatabaseReader & {
  insert: (tableName: string, doc: any) => Promise<Id<string>>
  patch: {
    <T extends string>(id: Id<T>, fields: Record<string, any>): Promise<void>
    <T extends string>(tableName: T, id: Id<T>, fields: Record<string, any>): Promise<void>
  }
  replace: {
    <T extends string>(id: Id<T>, doc: any): Promise<void>
    <T extends string>(tableName: T, id: Id<T>, doc: any): Promise<void>
  }
  delete: {
    <T extends string>(id: Id<T>): Promise<void>
    <T extends string>(tableName: T, id: Id<T>): Promise<void>
  }
}

export type QueryCtx = {
  db: DatabaseReader
  runQuery: (ref: any, args?: any) => Promise<any>
}

export type MutationCtx = {
  db: DatabaseWriter
  runQuery: (ref: any, args?: any) => Promise<any>
  runMutation: (ref: any, args?: any) => Promise<any>
  scheduler: { runAfter: (ms: number, ref: any, args?: any) => Promise<void> }
}

export type ActionCtx = {
  runQuery: (ref: any, args?: any) => Promise<any>
  runMutation: (ref: any, args?: any) => Promise<any>
  runAction: (ref: any, args?: any) => Promise<any>
  scheduler: { runAfter: (ms: number, ref: any, args?: any) => Promise<void> }
}

type QueryConfig<H> = { args?: any; returns?: any; handler: H }

export function query<H extends (ctx: QueryCtx, args: any) => any>(config: QueryConfig<H>): H {
  return config.handler
}

export function mutation<H extends (ctx: MutationCtx, args: any) => any>(
  config: QueryConfig<H>
): H {
  return config.handler
}

export function action<H extends (ctx: ActionCtx, args: any) => any>(config: QueryConfig<H>): H {
  return config.handler
}

export function internalQuery<H extends (ctx: QueryCtx, args: any) => any>(
  config: QueryConfig<H>
): H {
  return config.handler
}

export function internalMutation<H extends (ctx: MutationCtx, args: any) => any>(
  config: QueryConfig<H>
): H {
  return config.handler
}

export function internalAction<H extends (ctx: ActionCtx, args: any) => any>(
  config: QueryConfig<H>
): H {
  return config.handler
}
