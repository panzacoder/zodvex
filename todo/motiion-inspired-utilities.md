# Motiion-Inspired Utilities for zodvex

**Created:** 2025-01-18
**Status:** Proposal
**Priority:** High (Phase 1), Medium (Phase 2-3), Low (Phase 4)
**Inspiration:** Patterns discovered in plfx/motiion project

## Executive Summary

Analysis of the motiion project revealed **three critical patterns** that every Convex + Zod + React app needs:

1. **Runtime schema introspection** - Detecting field types, Convex IDs, validation rules
2. **Default value extraction** - Generating form defaults from schemas
3. **Form field type detection** - Mapping schemas to UI components

**Current state:** Every project reinvents these utilities using fragile `_def` access.

**Proposal:** zodvex should provide official, stable APIs for these patterns.

**Impact:**
- Reduces 200+ lines of utility code in typical apps
- Enables dynamic form generation
- Strengthens zodvex's "batteries included" value proposition
- Future-proofs apps against Zod internal changes

---

## Discovery: Motiion's Patterns

### Pattern 1: `detectConvexId()` - Runtime ID Detection

**Location:** `apps/native/utils/zodSafeAccess.ts`

**Purpose:** Detect Convex IDs at runtime to render appropriate UI components

**Implementation:**
```typescript
export interface ConvexIdInfo {
  isConvexId: boolean
  tableName?: string
}

export function detectConvexId(schema: z.ZodTypeAny): ConvexIdInfo {
  try {
    const typeName = getTypeName(schema)

    // Check 1: zodvex adds _tableName property to zid schemas
    const tableNameProp = (schema as any)?._tableName
    if (typeof tableNameProp === 'string' && tableNameProp.length > 0) {
      return { isConvexId: true, tableName: tableNameProp }
    }

    // Check 2: zodvex registry metadata
    const meta = registryHelpers.getMetadata(schema as any)
    if (meta?.isConvexId === true && typeof meta?.tableName === 'string') {
      return { isConvexId: true, tableName: meta.tableName }
    }

    // Check 3: ZodBranded type (legacy)
    if (typeName === 'ZodBranded') {
      const def = (schema as any)._def
      if (def?.brand && typeof def.brand === 'object') {
        if ('isConvexId' in def.brand && def.brand.isConvexId === true) {
          return {
            isConvexId: true,
            tableName: def.brand.tableName || 'unknown',
          }
        }
      }
    }

    return { isConvexId: false }
  } catch (error) {
    return { isConvexId: false }
  }
}
```

**Why it exists:**
- **File uploads** need to detect `zid('_storage')` to render file picker
- **Relationships** need to detect `zid(tableName)` to render entity selector
- **Autocomplete** needs table name to query related entities
- **Validation** needs to know if field is an ID

**Use cases in motiion:**
```typescript
// Render different UI based on field type
const convexIdInfo = detectConvexId(schema)
if (convexIdInfo.isConvexId) {
  const tableName = convexIdInfo.tableName

  if (tableName === '_storage') {
    return <FileUploadField />
  }

  return <RelationshipPicker tableName={tableName} />
}
```

**Problems with current approach:**
- ❌ Relies on internal zodvex properties (`_tableName`, registry)
- ❌ No official API - may break if zodvex changes
- ❌ Every project must implement this
- ❌ Fragile type checking with `_def` access

---

### Pattern 2: `getSchemaDefaults()` - Default Value Extraction

**Location:** `packages/backend/convex/schemas/utils/getSchemaDefaults.ts`

**Purpose:** Generate form default values from Zod schemas

**Implementation (153 lines!):**
```typescript
export function getSchemaDefaults<T extends z.ZodTypeAny>(
  schema: T
): z.infer<T> {
  return getDefaults(schema) as z.infer<T>
}

function getDefaults(schema: z.ZodTypeAny): any {
  // Access Zod v4 internal structure
  const def = (schema as any)._def || (schema as any).def
  if (!def) return undefined

  const type = def.type

  // Unwrap optional, nullable, and default schemas
  if (type === 'optional') return undefined
  if (type === 'nullable') return null
  if (type === 'default') {
    const defaultValue = def.defaultValue
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue
  }

  // Handle primitive types
  if (type === 'string') return ''
  if (type === 'number' || type === 'bigint') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  if (type === 'literal') return def.value

  // Handle enum types
  if (type === 'enum' || type === 'nativeEnum') {
    return undefined // Force explicit selection
  }

  // Handle container types
  if (type === 'array') return []

  if (type === 'object') {
    const shape = def.shape || {}
    const defaults: Record<string, any> = {}
    for (const key in shape) {
      defaults[key] = getDefaults(shape[key])
    }
    return defaults
  }

  if (type === 'record') return {}
  if (type === 'map') return new Map()
  if (type === 'set') return new Set()

  if (type === 'tuple') {
    const items = def.items || []
    return items.map((item: any) => getDefaults(item))
  }

  // Handle union types - use first type
  if (type === 'union') {
    const options = def.options || []
    return options.length > 0 ? getDefaults(options[0]) : undefined
  }

  if (type === 'discriminatedUnion') {
    const options = def.options || []
    return options.length > 0 ? getDefaults(options[0]) : undefined
  }

  // Handle intersection types - merge defaults
  if (type === 'intersection') {
    const left = def.left
    const right = def.right
    if (left && right) {
      return { ...getDefaults(left), ...getDefaults(right) }
    }
    return {}
  }

  // Handle lazy schemas
  if (type === 'lazy') {
    const getter = def.getter
    return getter ? getDefaults(getter()) : undefined
  }

  // Handle effects (refinements, transforms)
  if (type === 'effects' || type === 'transformer') {
    const innerSchema = def.schema || def.effect?.schema
    return innerSchema ? getDefaults(innerSchema) : undefined
  }

  // Handle branded types
  if (type === 'branded') {
    const innerType = def.type
    return innerType ? getDefaults(innerType) : undefined
  }

  // Handle pipeline
  if (type === 'pipeline') {
    const inSchema = def.in
    return inSchema ? getDefaults(inSchema) : undefined
  }

  // Handle catch
  if (type === 'catch') {
    const catchValue = def.catchValue
    return typeof catchValue === 'function' ? catchValue() : catchValue
  }

  // For any unknown types, return undefined
  return undefined
}
```

**Why it exists:**
- **Form initialization** - React Hook Form, TanStack Form need default values
- **Type safety** - Defaults match schema types perfectly
- **DRY principle** - Single source of truth for defaults
- **Reset functionality** - Reset forms to schema defaults

**Use cases in motiion:**
```typescript
// Form schema with defaults
export const workLocationFormDefaults = getSchemaDefaults(
  workLocationFormSchema
)

// Use in React Hook Form
const form = useForm({
  defaultValues: workLocationFormDefaults
})

// Use in TanStack Form
const form = useAppForm({
  defaultValues: sizingFormDefaults
})
```

**Problems with current approach:**
- ❌ 153 lines of complex code every project must write
- ❌ Directly accesses private `_def` API
- ❌ Will break if Zod internals change
- ❌ Must handle every Zod type manually
- ❌ Easy to miss edge cases

---

### Pattern 3: `convexSchemaToForm()` - Form Field Type Detection

**Location:** `apps/native/utils/convexSchemaToForm.ts`

**Purpose:** Map Zod schemas to form field types and configurations

**Implementation (partial):**
```typescript
export type FormFieldType =
  | 'text'
  | 'email'
  | 'url'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'date'
  | 'file'           // For zid('_storage')
  | 'relationship'   // For zid(tableName)
  | 'array'
  | 'object'

export function getFormFieldType(schema: z.ZodTypeAny): FormFieldType {
  const base = unwrapAll(schema)
  const typeName = getTypeName(base) || 'unknown'

  // Handle Convex IDs
  const convexIdInfo = detectConvexId(base)
  if (convexIdInfo.isConvexId) {
    const tableName = convexIdInfo.tableName
    if (tableName === '_storage') {
      return 'file'
    }
    return 'relationship'
  }

  // Handle email
  if (hasEmailCheck(base)) {
    return 'email'
  }

  // Handle URL
  if (hasUrlCheck(base)) {
    return 'url'
  }

  // Handle dates
  if (typeName === 'ZodDate' || hasDatetimeCheck(base)) {
    return 'date'
  }

  // Handle numbers
  if (typeName === 'ZodNumber' || typeName === 'ZodBigInt') {
    return 'number'
  }

  // Handle booleans
  if (typeName === 'ZodBoolean') {
    return 'checkbox'
  }

  // Handle enums
  if (typeName === 'ZodEnum' || typeName === 'ZodNativeEnum') {
    return 'select'
  }

  // Handle arrays
  if (typeName === 'ZodArray') {
    return 'multiselect'
  }

  // Default to text
  return 'text'
}

export function extractValidationRules(schema: z.ZodTypeAny): ValidationRules {
  // Extract min, max, pattern, required, etc.
  // from schema for client-side validation
}
```

**Why it exists:**
- **Dynamic forms** - Generate forms from schemas automatically
- **Consistent UX** - Same field types across app
- **Validation** - Extract rules for client-side validation
- **Developer experience** - Write schema once, get form UI free

**Use cases in motiion:**
```typescript
// Automatically render correct field type
const fieldType = getFormFieldType(schema)

switch (fieldType) {
  case 'email':
    return <EmailInput {...props} />
  case 'relationship':
    return <RelationshipPicker tableName={tableName} {...props} />
  case 'file':
    return <FileUploadField {...props} />
  case 'date':
    return <DatePicker {...props} />
  default:
    return <TextInput {...props} />
}
```

**Problems with current approach:**
- ❌ Complex logic spread across multiple utilities
- ❌ Accesses Zod internals (`_def`, `checks`)
- ❌ Not reusable across projects
- ❌ Hard to maintain as Zod evolves

---

## Why zodvex Should Provide These

### 1. **Alignment with "Batteries Included" Philosophy**

zodvex already provides:
- ✅ Table helpers (`zodTable`)
- ✅ Builder patterns (`zQueryBuilder`)
- ✅ Codec abstractions (`convexCodec`)

These introspection utilities are a **natural extension**:
- ✅ Frontend helpers (introspection)
- ✅ Form utilities (defaults, field types)
- ✅ React integration (hooks)

### 2. **zodvex Has Unique Knowledge**

zodvex **already parses** Zod schemas to convert them:
- We know which schemas are `zid` (registry + `_tableName`)
- We traverse schema structure in `zodToConvex`
- We handle optional/nullable/defaults in mapping
- We detect dates, arrays, objects, unions

**We can expose this knowledge via stable API!**

### 3. **Every Convex + React App Needs This**

Common workflow:
1. Define schema with Zod
2. Create Convex table
3. Build React form
4. **Need: default values, field types, validation**

Currently every project writes 200+ lines of fragile utilities.

### 4. **Competitive Advantage**

**convex-helpers:** Provides primitives only
**zodvex:** Can provide complete frontend story

This differentiates zodvex as the **"complete solution for Convex + Zod apps"**.

### 5. **Future-Proofing**

If we provide official APIs:
- ✅ Apps don't access `_def` directly
- ✅ We can maintain compatibility if Zod changes
- ✅ Single place to update if internals shift
- ✅ Type-safe, documented, tested

---

## Proposed Implementation

### **Phase 1: Core Introspection API** 🔴 High Priority

**Goal:** Stable API for schema introspection without `_def` access

**New File:** `src/introspection.ts`

```typescript
/**
 * Runtime schema introspection utilities
 *
 * Provides stable APIs for inspecting Zod schemas without accessing
 * private _def properties. Built on zodvex's existing schema parsing.
 */

import { z } from 'zod'
import type { GenericValidator } from 'convex/values'

/**
 * Comprehensive schema metadata extracted from Zod schema
 */
export interface SchemaIntrospection {
  // Base type information
  baseType:
    | 'string'
    | 'number'
    | 'bigint'
    | 'boolean'
    | 'date'
    | 'null'
    | 'literal'
    | 'object'
    | 'array'
    | 'union'
    | 'enum'
    | 'record'
    | 'tuple'
    | 'unknown'

  // Wrapper information
  isOptional: boolean
  isNullable: boolean
  isReadonly: boolean

  // Default values
  hasDefault: boolean
  defaultValue?: any

  // Convex-specific
  isConvexId: boolean
  tableName?: string

  // String validations
  isEmail?: boolean
  isUrl?: boolean
  isUuid?: boolean
  isCuid?: boolean
  isDatetime?: boolean
  pattern?: RegExp

  // Number validations
  min?: number
  max?: number
  isInt?: boolean
  isPositive?: boolean
  isNegative?: boolean

  // Array/String length
  minLength?: number
  maxLength?: number
  length?: number

  // Container details
  arrayElement?: SchemaIntrospection
  objectShape?: Record<string, SchemaIntrospection>
  unionOptions?: SchemaIntrospection[]
  enumValues?: readonly [string, ...string[]]

  // Literal value
  literalValue?: any

  // Description (from .describe())
  description?: string
}

/**
 * Introspect a Zod schema to extract metadata
 *
 * @example
 * const userId = zid('users')
 * const info = introspect(userId)
 * // { baseType: 'string', isConvexId: true, tableName: 'users', ... }
 */
export function introspect<T extends z.ZodTypeAny>(
  schema: T
): SchemaIntrospection {
  // Implementation leverages existing zodToConvex logic
  // We already walk the schema tree, just expose the metadata

  return introspectInternal(schema)
}

/**
 * Check if schema represents a Convex ID
 *
 * @example
 * isConvexId(zid('users')) // true
 * isConvexId(z.string()) // false
 */
export function isConvexId(schema: z.ZodTypeAny): boolean {
  return introspect(schema).isConvexId
}

/**
 * Get table name from a Convex ID schema
 *
 * @example
 * getTableName(zid('users')) // 'users'
 * getTableName(z.string()) // undefined
 */
export function getTableName(schema: z.ZodTypeAny): string | undefined {
  const info = introspect(schema)
  return info.isConvexId ? info.tableName : undefined
}

/**
 * Check if schema is optional
 *
 * @example
 * isOptional(z.string().optional()) // true
 * isOptional(z.string()) // false
 */
export function isOptional(schema: z.ZodTypeAny): boolean {
  return introspect(schema).isOptional
}

/**
 * Check if schema is nullable
 */
export function isNullable(schema: z.ZodTypeAny): boolean {
  return introspect(schema).isNullable
}

/**
 * Check if schema has a default value
 */
export function hasDefault(schema: z.ZodTypeAny): boolean {
  return introspect(schema).hasDefault
}

/**
 * Get default value from schema
 *
 * @example
 * const schema = z.string().default('hello')
 * getDefault(schema) // 'hello'
 */
export function getDefault(schema: z.ZodTypeAny): any {
  const info = introspect(schema)
  return info.hasDefault ? info.defaultValue : undefined
}

/**
 * Get base type of schema (unwrapping optional/nullable)
 */
export function getBaseType(schema: z.ZodTypeAny): SchemaIntrospection['baseType'] {
  return introspect(schema).baseType
}

// Internal implementation
function introspectInternal(schema: z.ZodTypeAny): SchemaIntrospection {
  // Leverage existing isZid helper
  if (isZid(schema)) {
    const meta = registryHelpers.getMetadata(schema)
    return {
      baseType: 'string',
      isOptional: false,
      isNullable: false,
      isReadonly: false,
      hasDefault: false,
      isConvexId: true,
      tableName: meta?.tableName || (schema as any)._tableName
    }
  }

  // Use existing schema traversal from zodToConvex
  // Extract metadata during traversal
  // Return comprehensive introspection object

  // ... implementation details
  // Can reuse much of zodToConvexInternal logic
}
```

**Export from main package:**
```typescript
// src/index.ts
export {
  introspect,
  isConvexId,
  getTableName,
  isOptional,
  isNullable,
  hasDefault,
  getDefault,
  getBaseType,
  type SchemaIntrospection
} from './introspection'
```

**Documentation:**
```md
### Runtime Schema Introspection

zodvex provides utilities for safely inspecting Zod schemas at runtime without accessing private APIs:

\`\`\`typescript
import { introspect, isConvexId, getTableName } from 'zodvex'

// Full introspection
const userId = zid('users')
const info = introspect(userId)
console.log(info)
// {
//   baseType: 'string',
//   isConvexId: true,
//   tableName: 'users',
//   isOptional: false,
//   isNullable: false,
//   ...
// }

// Convenience helpers
isConvexId(zid('users')) // true
getTableName(zid('users')) // 'users'
isOptional(z.string().optional()) // true
\`\`\`

**Use cases:**
- Dynamic form generation
- Runtime field type detection
- Conditional UI rendering
- Validation rule extraction
```

**Testing:**
```typescript
// __tests__/introspection.test.ts

describe('introspection', () => {
  describe('isConvexId', () => {
    it('detects zid schemas', () => {
      expect(isConvexId(zid('users'))).toBe(true)
      expect(isConvexId(z.string())).toBe(false)
    })

    it('works with optional zid', () => {
      expect(isConvexId(zid('users').optional())).toBe(true)
    })
  })

  describe('getTableName', () => {
    it('extracts table name from zid', () => {
      expect(getTableName(zid('users'))).toBe('users')
      expect(getTableName(zid('_storage'))).toBe('_storage')
    })
  })

  describe('introspect', () => {
    it('provides full metadata for string', () => {
      const info = introspect(z.string().email())
      expect(info.baseType).toBe('string')
      expect(info.isEmail).toBe(true)
    })

    it('detects optional and nullable', () => {
      const info = introspect(z.string().optional().nullable())
      expect(info.isOptional).toBe(true)
      expect(info.isNullable).toBe(true)
    })

    it('extracts default values', () => {
      const info = introspect(z.string().default('hello'))
      expect(info.hasDefault).toBe(true)
      expect(info.defaultValue).toBe('hello')
    })
  })
})
```

**Effort Estimate:** 6-8 hours
- Implement core introspection (3-4 hours)
- Add convenience helpers (1 hour)
- Write tests (2 hours)
- Documentation (1 hour)

---

### **Phase 2: Default Value Extraction** 🟡 Medium Priority

**Goal:** Generate form default values from schemas

**New File:** `src/defaults.ts`

```typescript
/**
 * Extract default values from Zod schemas for form initialization
 */

import { z } from 'zod'
import { introspect, type SchemaIntrospection } from './introspection'

/**
 * Generate default values from a Zod schema
 *
 * Useful for initializing forms with type-safe defaults.
 *
 * @example
 * const UserSchema = z.object({
 *   name: z.string(),
 *   age: z.number(),
 *   email: z.string().email().optional()
 * })
 *
 * const defaults = getSchemaDefaults(UserSchema)
 * // { name: '', age: 0, email: undefined }
 *
 * const form = useForm({ defaultValues: defaults })
 */
export function getSchemaDefaults<T extends z.ZodTypeAny>(
  schema: T
): z.infer<T> {
  const info = introspect(schema)
  return extractDefaults(info, schema) as z.infer<T>
}

function extractDefaults(
  info: SchemaIntrospection,
  schema: z.ZodTypeAny
): any {
  // Explicit default value
  if (info.hasDefault) {
    return info.defaultValue
  }

  // Optional fields default to undefined
  if (info.isOptional) {
    return undefined
  }

  // Nullable fields default to null
  if (info.isNullable) {
    return null
  }

  // Generate defaults based on base type
  switch (info.baseType) {
    case 'string':
      return ''

    case 'number':
    case 'bigint':
      return 0

    case 'boolean':
      return false

    case 'date':
      return new Date()

    case 'null':
      return null

    case 'literal':
      return info.literalValue

    case 'array':
      return []

    case 'object': {
      if (!info.objectShape) return {}

      const defaults: Record<string, any> = {}
      for (const [key, fieldInfo] of Object.entries(info.objectShape)) {
        defaults[key] = extractDefaults(
          fieldInfo,
          (schema as z.ZodObject<any>).shape[key]
        )
      }
      return defaults
    }

    case 'record':
      return {}

    case 'union': {
      // Use first option as default
      if (info.unionOptions && info.unionOptions.length > 0) {
        return extractDefaults(
          info.unionOptions[0],
          (schema as z.ZodUnion<any>).options[0]
        )
      }
      return undefined
    }

    case 'enum': {
      // Don't provide default for enums - force user selection
      return undefined
    }

    case 'tuple': {
      // Generate defaults for each tuple element
      // Not yet supported in introspection
      return []
    }

    default:
      return undefined
  }
}

/**
 * Generate partial defaults (only for fields with explicit defaults)
 *
 * @example
 * const schema = z.object({
 *   name: z.string(),
 *   role: z.string().default('user'),
 *   active: z.boolean().default(true)
 * })
 *
 * getPartialDefaults(schema)
 * // { role: 'user', active: true }
 */
export function getPartialDefaults<T extends z.ZodTypeAny>(
  schema: T
): Partial<z.infer<T>> {
  const info = introspect(schema)
  return extractPartialDefaults(info, schema) as Partial<z.infer<T>>
}

function extractPartialDefaults(
  info: SchemaIntrospection,
  schema: z.ZodTypeAny
): any {
  if (info.hasDefault) {
    return info.defaultValue
  }

  if (info.baseType === 'object' && info.objectShape) {
    const defaults: Record<string, any> = {}
    for (const [key, fieldInfo] of Object.entries(info.objectShape)) {
      const fieldDefault = extractPartialDefaults(
        fieldInfo,
        (schema as z.ZodObject<any>).shape[key]
      )
      if (fieldDefault !== undefined) {
        defaults[key] = fieldDefault
      }
    }
    return Object.keys(defaults).length > 0 ? defaults : undefined
  }

  return undefined
}
```

**Export:**
```typescript
// src/index.ts
export { getSchemaDefaults, getPartialDefaults } from './defaults'
```

**Documentation:**
```md
### Form Default Values

Generate type-safe default values from schemas:

\`\`\`typescript
import { getSchemaDefaults } from 'zodvex'

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  role: z.string().default('user'),
  email: z.string().email().optional()
})

// Full defaults
const defaults = getSchemaDefaults(UserSchema)
// { name: '', age: 0, role: 'user', email: undefined }

// Use with React Hook Form
const form = useForm({ defaultValues: defaults })

// Use with TanStack Form
const form = useForm({ defaultValues: defaults })

// Only fields with explicit defaults
const partialDefaults = getPartialDefaults(UserSchema)
// { role: 'user' }
\`\`\`
```

**Replaces:** 153 lines in motiion's `getSchemaDefaults.ts`

**Effort Estimate:** 4-6 hours

---

### **Phase 3: Form Field Type Detection** 🟡 Medium Priority

**Goal:** Map schemas to form field configurations

**New File:** `src/forms.ts`

```typescript
/**
 * Form generation utilities
 *
 * Convert Zod schemas to form field configurations for dynamic UIs
 */

import { z } from 'zod'
import { introspect, type SchemaIntrospection } from './introspection'
import { getSchemaDefaults } from './defaults'

/**
 * Form field types supported
 */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'url'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'date'
  | 'datetime'
  | 'file'           // For zid('_storage')
  | 'relationship'   // For zid(tableName)
  | 'textarea'
  | 'password'
  | 'hidden'

/**
 * Configuration for a form field
 */
export interface FormFieldConfig {
  // Field identification
  name: string
  type: FormFieldType

  // Display
  label?: string
  placeholder?: string
  description?: string

  // Validation
  required: boolean
  disabled?: boolean
  readonly?: boolean

  // Type-specific
  tableName?: string          // For relationship fields
  options?: FormFieldOption[] // For select/enum fields
  multiple?: boolean          // For multiselect/file fields

  // Number constraints
  min?: number
  max?: number
  step?: number

  // String constraints
  minLength?: number
  maxLength?: number
  pattern?: string

  // Defaults
  defaultValue?: any
}

export interface FormFieldOption {
  label: string
  value: any
}

/**
 * Detect form field type from schema
 *
 * @example
 * getFormFieldType(z.string().email()) // 'email'
 * getFormFieldType(zid('users')) // 'relationship'
 * getFormFieldType(zid('_storage')) // 'file'
 */
export function getFormFieldType(schema: z.ZodTypeAny): FormFieldType {
  const info = introspect(schema)

  // Convex IDs
  if (info.isConvexId) {
    return info.tableName === '_storage' ? 'file' : 'relationship'
  }

  // String variants
  if (info.baseType === 'string') {
    if (info.isEmail) return 'email'
    if (info.isUrl) return 'url'
    if (info.isDatetime) return 'datetime'
    if (info.maxLength && info.maxLength > 100) return 'textarea'
    return 'text'
  }

  // Numbers
  if (info.baseType === 'number' || info.baseType === 'bigint') {
    return 'number'
  }

  // Booleans
  if (info.baseType === 'boolean') {
    return 'checkbox'
  }

  // Dates
  if (info.baseType === 'date') {
    return 'date'
  }

  // Enums
  if (info.baseType === 'enum') {
    return 'select'
  }

  // Arrays
  if (info.baseType === 'array') {
    // Check if array element is enum-like
    if (info.arrayElement?.baseType === 'enum') {
      return 'multiselect'
    }
    // Check if array of files
    if (info.arrayElement?.isConvexId &&
        info.arrayElement?.tableName === '_storage') {
      return 'file' // with multiple=true
    }
    // Generic array
    return 'multiselect'
  }

  // Default
  return 'text'
}

/**
 * Generate form configuration from object schema
 *
 * @example
 * const UserSchema = z.object({
 *   email: z.string().email(),
 *   age: z.number().min(13),
 *   agencyId: zid('agencies').optional()
 * })
 *
 * const config = schemaToFormConfig(UserSchema)
 * // {
 * //   email: { type: 'email', required: true, ... },
 * //   age: { type: 'number', required: true, min: 13, ... },
 * //   agencyId: { type: 'relationship', required: false, tableName: 'agencies', ... }
 * // }
 */
export function schemaToFormConfig<T extends z.ZodObject<any>>(
  schema: T,
  options?: {
    labels?: Record<string, string>
    placeholders?: Record<string, string>
    descriptions?: Record<string, string>
  }
): Record<string, FormFieldConfig> {
  const info = introspect(schema)

  if (info.baseType !== 'object' || !info.objectShape) {
    throw new Error('schemaToFormConfig requires an object schema')
  }

  const config: Record<string, FormFieldConfig> = {}

  for (const [key, fieldInfo] of Object.entries(info.objectShape)) {
    const fieldSchema = schema.shape[key]

    config[key] = {
      name: key,
      type: getFormFieldType(fieldSchema),

      // Labels
      label: options?.labels?.[key] || formatLabel(key),
      placeholder: options?.placeholders?.[key],
      description: options?.descriptions?.[key] || fieldInfo.description,

      // Validation
      required: !fieldInfo.isOptional && !fieldInfo.isNullable,
      readonly: fieldInfo.isReadonly,

      // Type-specific
      tableName: fieldInfo.tableName,
      options: fieldInfo.enumValues?.map(val => ({
        label: String(val),
        value: val
      })),
      multiple: fieldInfo.baseType === 'array',

      // Number constraints
      min: fieldInfo.min,
      max: fieldInfo.max,
      step: fieldInfo.isInt ? 1 : undefined,

      // String constraints
      minLength: fieldInfo.minLength,
      maxLength: fieldInfo.maxLength,
      pattern: fieldInfo.pattern?.source,

      // Default
      defaultValue: fieldInfo.hasDefault ? fieldInfo.defaultValue : undefined
    }
  }

  return config
}

/**
 * Format field name as label
 * userId → User ID
 * firstName → First Name
 */
function formatLabel(name: string): string {
  return name
    // Insert space before capital letters
    .replace(/([A-Z])/g, ' $1')
    // Capitalize first letter of each word
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

/**
 * Get enum options from schema
 */
export function getEnumOptions(schema: z.ZodTypeAny): FormFieldOption[] | undefined {
  const info = introspect(schema)

  if (info.baseType !== 'enum' || !info.enumValues) {
    return undefined
  }

  return info.enumValues.map(val => ({
    label: String(val),
    value: val
  }))
}

/**
 * Extract validation rules for client-side validation
 */
export function getValidationRules(schema: z.ZodTypeAny): {
  required?: boolean
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  email?: boolean
  url?: boolean
} {
  const info = introspect(schema)

  return {
    required: !info.isOptional && !info.isNullable,
    min: info.min,
    max: info.max,
    minLength: info.minLength,
    maxLength: info.maxLength,
    pattern: info.pattern,
    email: info.isEmail,
    url: info.isUrl
  }
}
```

**Export:**
```typescript
// src/index.ts
export {
  getFormFieldType,
  schemaToFormConfig,
  getEnumOptions,
  getValidationRules,
  type FormFieldType,
  type FormFieldConfig,
  type FormFieldOption
} from './forms'
```

**Documentation:**
```md
### Form Generation

Generate form configurations from schemas:

\`\`\`typescript
import { schemaToFormConfig } from 'zodvex'

const UserSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(13),
  role: z.enum(['admin', 'user']),
  agencyId: zid('agencies').optional()
})

const formConfig = schemaToFormConfig(UserSchema, {
  labels: {
    agencyId: 'Agency / Manager'
  }
})

// Render dynamic form
{Object.entries(formConfig).map(([key, config]) => {
  switch (config.type) {
    case 'email':
      return <EmailInput key={key} {...config} />
    case 'number':
      return <NumberInput key={key} {...config} />
    case 'select':
      return <Select key={key} options={config.options} {...config} />
    case 'relationship':
      return <RelationshipPicker key={key} tableName={config.tableName} {...config} />
    case 'file':
      return <FileUpload key={key} {...config} />
    default:
      return <TextInput key={key} {...config} />
  }
})}
\`\`\`
```

**Effort Estimate:** 6-8 hours

---

### **Phase 4: React Integration** 🔵 Lower Priority

**Goal:** React hooks and components for common patterns

**New Package:** `zodvex/react` (optional companion package)

```typescript
/**
 * zodvex/react - React integration for zodvex
 */

import { z } from 'zod'
import { useMemo } from 'react'
import { getSchemaDefaults, schemaToFormConfig } from 'zodvex'
import type { FormFieldConfig } from 'zodvex'

/**
 * Hook to get form defaults from schema
 */
export function useFormDefaults<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  return useMemo(() => getSchemaDefaults(schema), [schema])
}

/**
 * Hook to get form configuration from schema
 */
export function useFormConfig<T extends z.ZodObject<any>>(
  schema: T,
  options?: Parameters<typeof schemaToFormConfig>[1]
): Record<string, FormFieldConfig> {
  return useMemo(
    () => schemaToFormConfig(schema, options),
    [schema, options]
  )
}

/**
 * Auto-form component (example)
 */
export function AutoForm<T extends z.ZodObject<any>>({
  schema,
  onSubmit,
  children
}: {
  schema: T
  onSubmit: (data: z.infer<T>) => void | Promise<void>
  children?: React.ReactNode
}) {
  const config = useFormConfig(schema)
  const defaults = useFormDefaults(schema)

  // Implementation using react-hook-form or similar
  // This is just a concept - actual implementation would be more involved

  return (
    <form>
      {Object.entries(config).map(([key, fieldConfig]) => (
        <AutoField key={key} config={fieldConfig} />
      ))}
      {children}
    </form>
  )
}

// ... more React-specific utilities
```

**Separate package because:**
- Not all zodvex users use React
- Avoids React peer dependency in main package
- Can support other frameworks (Vue, Svelte) separately

**Effort Estimate:** 2-3 days

---

## Implementation Roadmap

### **Immediate (Next PR) - Week 1**

**Focus:** Phase 1 - Core introspection

- [ ] Implement `src/introspection.ts`
- [ ] Core `introspect()` function
- [ ] Convenience helpers (`isConvexId`, `getTableName`, etc.)
- [ ] Comprehensive tests
- [ ] Documentation in README
- [ ] Add to API reference

**Deliverable:** Stable API for detecting Convex IDs and inspecting schemas

**Effort:** 6-8 hours

---

### **Short-term (Separate PR) - Week 2**

**Focus:** Phase 2 - Default value extraction

- [ ] Implement `src/defaults.ts`
- [ ] `getSchemaDefaults()` function
- [ ] `getPartialDefaults()` function
- [ ] Tests covering all schema types
- [ ] Documentation with form examples

**Deliverable:** Official default value extraction utility

**Effort:** 4-6 hours

---

### **Medium-term (Separate PR) - Week 3-4**

**Focus:** Phase 3 - Form field detection

- [ ] Implement `src/forms.ts`
- [ ] `getFormFieldType()` function
- [ ] `schemaToFormConfig()` function
- [ ] Validation rule extraction
- [ ] Tests and examples
- [ ] Documentation with dynamic form examples

**Deliverable:** Complete form generation utilities

**Effort:** 6-8 hours

---

### **Long-term (Future) - Month 2+**

**Focus:** Phase 4 - React integration

- [ ] Create `zodvex/react` package
- [ ] React hooks (`useFormDefaults`, `useFormConfig`)
- [ ] Example components
- [ ] Separate documentation site
- [ ] Integration examples

**Deliverable:** Optional React companion package

**Effort:** 2-3 days

---

## Benefits Analysis

### **For Motiion Project**

**Before (current):**
```typescript
// 3 separate utility files, 300+ lines
utils/zodSafeAccess.ts          (150 lines)
utils/convexSchemaToForm.ts     (100 lines)
schemas/utils/getSchemaDefaults.ts (153 lines)

// Fragile _def access throughout
const def = (schema as any)._def
const type = def.type
```

**After (with zodvex utilities):**
```typescript
import {
  introspect,
  isConvexId,
  getTableName,
  getSchemaDefaults,
  schemaToFormConfig
} from 'zodvex'

// Can delete 3 utility files
// Stable API, no _def access
// Type-safe, documented, tested
```

**Savings:**
- ✅ Remove 300+ lines of utility code
- ✅ Eliminate fragile `_def` access
- ✅ Better type safety
- ✅ Future-proof against Zod changes
- ✅ Consistent with zodvex patterns

---

### **For zodvex Users**

**Enables new use cases:**
1. **Dynamic form generation** - Build forms from schemas automatically
2. **Conditional rendering** - Render different UI based on field type
3. **Validation extraction** - Get client-side rules from schemas
4. **Relationship detection** - Know which fields are foreign keys
5. **File upload detection** - Render file pickers for storage IDs

**Example applications:**
- Admin panels with auto-generated forms
- Survey/form builders
- CMS systems
- Data entry applications
- Mobile apps with dynamic UIs (like motiion)

---

### **For zodvex Package**

**Competitive positioning:**

| Feature | convex-helpers | zodvex |
|---------|----------------|--------|
| Schema mapping | ✅ | ✅ |
| Table helpers | ❌ | ✅ |
| Builder pattern | ❌ | ✅ |
| **Introspection** | ❌ | ✅ (NEW) |
| **Form defaults** | ❌ | ✅ (NEW) |
| **Form generation** | ❌ | ✅ (NEW) |
| React integration | ❌ | ✅ (NEW) |

**Marketing message:**
> "zodvex: The complete solution for Convex + Zod apps"
>
> From backend schema to frontend forms, zodvex provides everything you need:
> - ✅ Type-safe table definitions
> - ✅ Builder pattern APIs
> - ✅ Runtime schema introspection
> - ✅ Automatic form generation
> - ✅ React integration (optional)

---

## Migration Guide

### **For Existing Users**

Utilities are **additive only** - no breaking changes:

```typescript
// Existing code continues to work
import { zid, zodTable, zQueryBuilder } from 'zodvex'

// New utilities are opt-in
import { isConvexId, getSchemaDefaults } from 'zodvex'
```

### **For Motiion Project**

**Step 1: Update zodvex**
```bash
cd packages/backend
bun update zodvex
```

**Step 2: Replace detectConvexId (optional)**
```typescript
// Before
import { detectConvexId } from '~/utils/zodSafeAccess'

// After
import { isConvexId, getTableName } from 'zodvex'

const isId = isConvexId(schema)
const table = getTableName(schema)
```

**Step 3: Replace getSchemaDefaults (optional)**
```typescript
// Before
import { getSchemaDefaults } from '../schemas/utils/getSchemaDefaults'

// After
import { getSchemaDefaults } from 'zodvex'

// Same API!
const defaults = getSchemaDefaults(schema)
```

**Step 4: Clean up (optional)**
```bash
# Can delete these files once migrated
rm apps/native/utils/zodSafeAccess.ts
rm packages/backend/convex/schemas/utils/getSchemaDefaults.ts
rm apps/native/utils/convexSchemaToForm.ts  # After form utilities added
```

---

## Open Questions

### **Question 1: API Surface**

Should we expose low-level `introspect()` or just convenience helpers?

**Option A: Full exposure**
```typescript
const info = introspect(schema)
if (info.isConvexId) { ... }
```

**Option B: Only helpers**
```typescript
if (isConvexId(schema)) { ... }
```

**Recommendation:** Expose both. Power users get full metadata, casual users get simple helpers.

---

### **Question 2: Package Structure**

Should React utilities be:

**Option A:** Separate `zodvex-react` package
- ✅ No React peer dep in main package
- ✅ Clear separation
- ❌ More packages to maintain

**Option B:** Subpath export `zodvex/react`
- ✅ Single package
- ✅ Easier versioning
- ❌ React peer dep required

**Recommendation:** Option B (subpath) with conditional peer dependency.

---

### **Question 3: Framework Coverage**

Should we support other frameworks?

- `zodvex/react` - React hooks
- `zodvex/vue` - Vue composables
- `zodvex/svelte` - Svelte stores

**Recommendation:** Start with React only. Add others based on demand.

---

### **Question 4: Validation Integration**

Should we provide adapters for validation libraries?

```typescript
// React Hook Form adapter
import { zodResolver } from 'zodvex/react-hook-form'

const form = useForm({
  defaultValues: getSchemaDefaults(schema),
  resolver: zodResolver(schema)
})
```

**Recommendation:** Document patterns, don't build adapters (they exist).

---

## Success Metrics

How do we know if this is successful?

1. **Adoption:** % of zodvex users importing introspection utilities
2. **GitHub stars:** Increase from better frontend story
3. **Issues closed:** "How do I detect Convex IDs?" type questions
4. **Bundle:** motiion reduces utility code by 300+ lines
5. **Comparison:** Clearer differentiation from convex-helpers

---

## Risks & Mitigations

### **Risk 1: Maintenance Burden**

**Risk:** More code to maintain as Zod evolves

**Mitigation:**
- We already parse schemas in `zodToConvex`
- Introspection reuses that logic
- Centralized in one place

### **Risk 2: Breaking Changes in Zod**

**Risk:** Zod v5 might change internals

**Mitigation:**
- We provide stable API wrapper
- Users protected from Zod changes
- We handle compatibility in one place

### **Risk 3: Scope Creep**

**Risk:** Feature requests for every framework/library

**Mitigation:**
- Clear phases with priority
- Start minimal (Phase 1)
- Expand based on demand
- Document patterns over building adapters

### **Risk 4: Performance**

**Risk:** Introspection might be slow for large schemas

**Mitigation:**
- Reuse existing traversal logic
- Memoization at application level
- Lazy evaluation where possible

---

## Conclusion

The patterns in motiion reveal a **critical gap** in zodvex's offering: **frontend integration**.

**Current state:** Every project writes 200-300 lines of fragile utilities.

**Proposed state:** zodvex provides official, stable APIs.

**Recommendation:** **Implement Phase 1 immediately** (6-8 hours), then evaluate success before proceeding to later phases.

**This aligns perfectly with zodvex's philosophy:**
> "Batteries included, opinionated solution for Convex + Zod apps"

The frontend utilities are **natural extensions** of what zodvex already does well.

---

## Next Steps

1. **Review & approve** this proposal
2. **Implement Phase 1** (introspection utilities)
3. **Test in motiion** as real-world validation
4. **Document thoroughly**
5. **Gather feedback** before Phase 2
6. **Blog post** about frontend integration story

---

## References

**Code Locations:**
- motiion/apps/native/utils/zodSafeAccess.ts
- motiion/apps/native/utils/convexSchemaToForm.ts
- motiion/packages/backend/convex/schemas/utils/getSchemaDefaults.ts

**Related Issues:**
- Issue #22 (zid compatibility) ✅ Fixed
- Issue #20 (union tables) - Related pattern
- Future: "How to detect Convex IDs in UI?"

**Similar Tools:**
- zod-to-json-schema (JSON Schema generation)
- react-hook-form-zod (Zod + RHF integration)
- auto-form (Shadcn/ui component)

None provide Convex-specific introspection!
