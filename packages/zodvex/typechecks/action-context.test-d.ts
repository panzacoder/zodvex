import type { GenericActionCtx, GenericDataModel } from 'convex/server'
import type { Overwrite } from '../src/internal/types'
import type { Equal, Expect } from './test-helpers'

// --- Test 1: Overwrite<T, {}> preserves T ---
type ActionCtx = GenericActionCtx<GenericDataModel>
type WithEmpty = Overwrite<ActionCtx, {}>
// auth should still be accessible — not collapsed to never
type _AuthPreserved = Expect<Equal<WithEmpty['auth'], ActionCtx['auth']>>

// --- Test 2: Overwrite<T, Record<string, never>> guard clause ---
// This is the bug case — Record<string, never> has keyof = string,
// which would collapse T via Omit<T, string> without the guard clause.
type WithRecordNever = Overwrite<ActionCtx, Record<string, never>>
// Guard clause: keyof Record<string, never> is string, NOT never.
// But our Overwrite has: keyof U extends never ? T : Omit<T, keyof U> & U
// keyof Record<string, never> = string, string extends never = false,
// so this hits the Omit branch. The guard only helps for {}.
// This documents the current behavior — {} is the correct fix, not Record<string, never>.
type _RecordNeverCollapses = Expect<Equal<keyof WithRecordNever, string>>

// --- Test 3: NoCodecCtx ({}) flows through ZodvexBuilder.withContext correctly ---
// Simulate what za.withContext() does: the input customization sees
// Overwrite<InputCtx, CodecCtx> where CodecCtx = {} for actions.
type SimulatedInput = Overwrite<ActionCtx, {}>
// The input should preserve all ActionCtx properties — auth must be accessible.
// We test property-level equality rather than whole-type Equal because the
// conditional type wrapper is not identical to the bare type under Equal<>.
type _InputHasAuth = Expect<Equal<SimulatedInput['auth'], ActionCtx['auth']>>
type _InputHasScheduler = Expect<Equal<SimulatedInput['scheduler'], ActionCtx['scheduler']>>
// Verify assignability in both directions
type _InputExtendsCtx = SimulatedInput extends ActionCtx ? true : false
type _CtxExtendsInput = ActionCtx extends SimulatedInput ? true : false
type _Bidir = Expect<Equal<_InputExtendsCtx, true>> & Expect<Equal<_CtxExtendsInput, true>>

// --- Test 4: After .withContext(), custom ctx merges cleanly ---
type CustomCtx = { securityCtx: string }
type MergedCodecAndCustom = Overwrite<{}, CustomCtx>
// Overwrite<{}, CustomCtx> = Omit<{}, "securityCtx"> & CustomCtx — structurally equivalent to CustomCtx
type _MergedHasSecurityCtx = Expect<Equal<MergedCodecAndCustom['securityCtx'], string>>
type FinalHandlerCtx = Overwrite<ActionCtx, MergedCodecAndCustom>
// Handler should see ActionCtx & { securityCtx: string }
type _HasAuth = Expect<Equal<FinalHandlerCtx['auth'], ActionCtx['auth']>>
type _HasSecurityCtx = Expect<Equal<FinalHandlerCtx['securityCtx'], string>>
