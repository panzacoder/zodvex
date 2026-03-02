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
// Function builders (zQueryBuilder, zMutationBuilder, zActionBuilder, etc.)
export * from '../builders'
// Custom function utilities (zCustomQuery, zCustomMutation, zCustomAction, etc.)
export * from '../custom'
// Codec customization (manual composition escape hatch)
export { createZodvexCustomization } from '../customization'
// Database wrappers (ZodvexDatabaseReader, ZodvexDatabaseWriter, etc.)
export * from '../db'
// One-time setup + types
export {
  initZodvex,
  type ZodvexActionCtx,
  type ZodvexBuilder,
  type ZodvexMutationCtx,
  type ZodvexQueryCtx
} from '../init'
// Rule and audit types for .withRules() and .audit()
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
// Table creation and helpers
export * from '../tables'
