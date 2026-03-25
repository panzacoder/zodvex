/**
 * zodvex/server - Server-only utilities
 *
 * This module contains imports from convex/server and convex-helpers/server.
 * Only import this in:
 * - convex/schema.ts
 * - Convex function files (queries, mutations, actions)
 * - Server-side code
 *
 * DO NOT import in React components or client-side code.
 */

// Re-export customCtx for convenience
export { customCtx } from 'convex-helpers/server/customFunctions'
// Action context wrapping (auto-codec for runQuery/runMutation in actions)
export { createZodvexActionCtx } from '../actionCtx'
// Function builders (named — all deprecated)
export {
  zActionBuilder,
  zCustomActionBuilder,
  zCustomMutationBuilder,
  zCustomQueryBuilder,
  zMutationBuilder,
  zQueryBuilder
} from '../builders'
// Custom function utilities (named — hide customFnBuilder, Overwrite re-export)
export { type CustomBuilder, zCustomAction, zCustomMutation, zCustomQuery } from '../custom'
// Codec customization (manual composition escape hatch)
export { createZodvexCustomization } from '../customization'
// Database wrappers (ZodvexDatabaseReader, ZodvexDatabaseWriter, etc.)
export {
  createZodDbReader,
  createZodDbWriter,
  ZodvexDatabaseReader,
  ZodvexDatabaseWriter,
  type ZodvexExpression,
  type ZodvexExpressionOrValue,
  type ZodvexFilterBuilder,
  type ZodvexIndexFieldValue,
  type ZodvexIndexRangeBuilder,
  type ZodvexLowerBoundBuilder,
  ZodvexQueryChain,
  type ZodvexUpperBoundBuilder
} from '../db'
// One-time setup + types
export {
  initZodvex,
  type ZodvexActionCtx,
  type ZodvexBuilder,
  type ZodvexMutationCtx,
  type ZodvexQueryCtx
} from '../init'
// Rule and audit types for .withRules() and .audit()
//
// Rule and audit types (re-exported from ruleTypes.ts via rules.ts)
export type {
  DeleteRule,
  InsertRule,
  PatchRule,
  ReaderAuditConfig,
  ReadRule,
  ReplaceRule,
  TableRules,
  WriteEvent,
  WriterAuditConfig,
  ZodvexRules,
  ZodvexRulesConfig
} from '../rules'
// Schema definition (defineZodSchema)
export * from '../schema'
// Schema helpers (pure Zod, no server deps)
export { addSystemFields } from '../schemaHelpers'
// Table creation and helpers (named — hide union internals)
export { zodDoc, zodDocOrNull, zodTable } from '../tables'
