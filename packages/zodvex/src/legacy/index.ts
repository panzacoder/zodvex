/**
 * zodvex/legacy - Deprecated runtime APIs retained for migration.
 *
 * Prefer the canonical public surfaces:
 * - `zodvex`
 * - `zodvex/server`
 * - `zodvex/mini`
 * - `zodvex/mini/server`
 */

export {
  zActionBuilder,
  zCustomActionBuilder,
  zCustomMutationBuilder,
  zCustomQueryBuilder,
  zMutationBuilder,
  zQueryBuilder
} from '../builders'
export { zodDoc, zodDocOrNull, zodTable } from '../tables'
