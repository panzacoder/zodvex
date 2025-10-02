// Shared type testing helpers for typecheck tests

/**
 * Type equality checker
 * Returns true if types A and B are exactly equal
 */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false

/**
 * Type assertion helper
 * Ensures the type parameter is exactly true
 */
export type Expect<T extends true> = T
