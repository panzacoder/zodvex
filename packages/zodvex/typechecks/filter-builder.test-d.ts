import type { ExpressionOrValue, FilterBuilder } from 'convex/server'
import type {
  ZodvexExpression,
  ZodvexExpressionOrValue,
  ZodvexFilterBuilder,
  ZodvexQueryChain,
} from '../src/internal/db'
import type { Equal, Expect } from './test-helpers'

// --- Mock table types for testing ---
type MockDoc = { _id: string; _creationTime: number; name: string; createdAt: number }
type MockDecodedDoc = { _id: string; _creationTime: number; name: string; createdAt: Date }
type MockTableInfo = {
  document: MockDoc
  fieldPaths: keyof MockDoc
  indexes: {}
  searchIndexes: {}
  vectorIndexes: {}
}

type QB = ZodvexFilterBuilder<MockTableInfo, MockDecodedDoc>

// --- Test 1: eq() returns ZodvexExpression<boolean> ---
type _T1 = Expect<Equal<ReturnType<QB['eq']>, ZodvexExpression<boolean>>>

// --- Test 2: and() returns ZodvexExpression<boolean> ---
type _T2 = Expect<Equal<ReturnType<QB['and']>, ZodvexExpression<boolean>>>

// ============================================================================
// Call-site overload resolution tests
// ============================================================================

declare const chain: ZodvexQueryChain<MockTableInfo, MockDecodedDoc>

// --- Test 3: Inline decoded-aware filter WITHOUT annotation (overload 1) ---
const _inlineDecoded = chain.filter(q => q.gte(q.field('createdAt'), new Date()))

// --- Test 4: Convex-native predicate passed directly (overload 2) ---
const isNamed = (q: FilterBuilder<MockTableInfo>) => q.neq(q.field('name'), null)
const _nativeDirect = chain.filter(isNamed)

// --- Test 5: Chained filters — legacy then decoded-aware (no annotation) ---
const _chained = chain
  .filter(isNamed)
  .filter(q => q.gte(q.field('createdAt'), new Date()))

// --- Test 6: Mixed composition in single callback does NOT compile ---
// isNamed expects FilterBuilder, but q is ZodvexFilterBuilder — incompatible
const _mixedFail = chain.filter(
  (q: ZodvexFilterBuilder<MockTableInfo, MockDecodedDoc>) =>
    // @ts-expect-error — ZodvexFilterBuilder is not assignable to FilterBuilder
    q.and(isNamed(q), q.gte(q.field('createdAt'), new Date()))
)

// --- Test 7: filter() returns ZodvexQueryChain (chainable) ---
type FilterReturn = typeof _inlineDecoded
type _T7 = Expect<Equal<FilterReturn, ZodvexQueryChain<MockTableInfo, MockDecodedDoc>>>

// --- Test 8: Type error for wrong value type ---
const _wrongType = chain.filter(
  (q: ZodvexFilterBuilder<MockTableInfo, MockDecodedDoc>) =>
    // @ts-expect-error — createdAt resolves to Date, "not-a-date" is string
    q.eq(q.field('createdAt'), 'not-a-date')
)
