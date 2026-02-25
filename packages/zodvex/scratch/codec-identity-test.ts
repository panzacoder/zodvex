/**
 * Test: does .partial() preserve codec instance identity?
 *
 * If the codec inside .partial()'s optional wrapper is the SAME object
 * as the original model field's codec, then codecMap identity matching
 * will work for derived schemas.
 */
import { z } from 'zod'
import { zx } from '../src/core'

// Factory-created codec (like hotpot's sensitive())
function tagged<T extends z.ZodTypeAny>(inner: T) {
  return zx.codec(
    z.object({ value: inner, tag: z.string() }),
    z.object({ value: inner, tag: z.string(), displayValue: z.string() }),
    {
      decode: (wire: any) => ({ ...wire, displayValue: `[${wire.tag}] ${wire.value}` }),
      encode: (rt: any) => ({ value: rt.value, tag: rt.tag }),
    }
  )
}

// Simulate a model schema
const emailCodec = tagged(z.string())
const modelSchema = z.object({
  name: z.string(),
  email: emailCodec.optional(),
  phone: tagged(z.string()).nullable(),
})

// Derive via .partial()
const partialSchema = modelSchema.partial()

// Derive via .extend()
const extendedSchema = modelSchema.extend({ _id: z.string() })

// Derive via .partial().extend()
const partialExtended = modelSchema.partial().extend({ _id: z.string() })

// === Identity checks ===

// 1. Does .partial() preserve the codec identity?
const originalEmailField = (modelSchema.shape as any).email  // ZodOptional<codec>
const partialEmailField = (partialSchema.shape as any).email  // ZodOptional<ZodOptional<codec>> ?

console.log('=== .partial() identity ===')
console.log('Original email field type:', originalEmailField.constructor.name)
console.log('Partial email field type:', partialEmailField.constructor.name)

// Unwrap original: ZodOptional → codec
const originalCodec = originalEmailField._zod.def.innerType
console.log('Original codec type:', originalCodec.constructor.name)
console.log('Original codec === emailCodec:', originalCodec === emailCodec)

// Unwrap partial: how deep do we need to go?
let current = partialEmailField
let depth = 0
while (current instanceof z.ZodOptional) {
  depth++
  current = current._zod.def.innerType
}
console.log('Partial unwrap depth to codec:', depth)
console.log('Partial inner type:', current.constructor.name)
console.log('Partial codec === emailCodec:', current === emailCodec)
console.log('Partial codec === originalCodec:', current === originalCodec)

// 2. Does .extend() preserve identity?
console.log('\n=== .extend() identity ===')
const extendedEmailField = (extendedSchema.shape as any).email
const extendedCodec = extendedEmailField._zod.def.innerType
console.log('Extended codec === emailCodec:', extendedCodec === emailCodec)

// 3. Does .partial().extend() preserve identity?
console.log('\n=== .partial().extend() identity ===')
const peEmailField = (partialExtended.shape as any).email
current = peEmailField
depth = 0
while (current instanceof z.ZodOptional) {
  depth++
  current = current._zod.def.innerType
}
console.log('partial().extend() unwrap depth:', depth)
console.log('partial().extend() codec === emailCodec:', current === emailCodec)

// 4. Phone field (nullable, not optional)
console.log('\n=== nullable field identity ===')
const originalPhoneField = (modelSchema.shape as any).phone  // ZodNullable<codec>
const originalPhoneCodec = originalPhoneField._zod.def.innerType
console.log('Phone codec type:', originalPhoneCodec.constructor.name)
const partialPhoneField = (partialSchema.shape as any).phone
// Partial of nullable: ZodOptional<ZodNullable<codec>> ?
current = partialPhoneField
depth = 0
const wrappers: string[] = []
while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
  wrappers.push(current.constructor.name)
  current = current._zod.def.innerType
  depth++
}
console.log('Partial phone wrappers:', wrappers.join(' → '))
console.log('Partial phone codec === originalPhoneCodec:', current === originalPhoneCodec)

// 5. .pick() and .omit()
console.log('\n=== .pick() / .omit() identity ===')
const pickedSchema = modelSchema.pick({ email: true })
const pickedEmailField = (pickedSchema.shape as any).email
const pickedCodec = pickedEmailField._zod.def.innerType
console.log('pick() codec === emailCodec:', pickedCodec === emailCodec)

const omittedSchema = modelSchema.omit({ name: true })
const omittedEmailField = (omittedSchema.shape as any).email
const omittedCodec = omittedEmailField._zod.def.innerType
console.log('omit() codec === emailCodec:', omittedCodec === emailCodec)

console.log('\n=== Summary ===')
console.log('If all checks pass, codecMap identity matching works for derived schemas.')
