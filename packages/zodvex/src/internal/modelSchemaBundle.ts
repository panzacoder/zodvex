import { z } from 'zod'
import {
  addSystemFields,
  createUnionFromOptions,
  getUnionOptions,
  isZodUnion
} from './schemaHelpers'
import { $ZodObject, $ZodOptional, type $ZodShape, $ZodType } from './zod-core'
import { zx } from './zx'

// Return type alias so helper signatures don't expose full zod internals everywhere.
type AnyOptional = z.ZodOptional<any> // zod-ok

export type RuntimeModelSchemaBundle = {
  readonly doc: $ZodType
  readonly base: $ZodType
  readonly insert: $ZodType
  readonly update: $ZodType
  readonly docArray: $ZodType
  readonly paginatedDoc: $ZodType
}

/** Wrap in .optional() only if not already optional. Uses core constructor for zod-mini compat. */
function ensureOptional(schema: $ZodType): AnyOptional {
  if (schema instanceof $ZodOptional) return schema as z.ZodOptional<any> // zod-ok
  return new $ZodOptional({ type: 'optional', innerType: schema }) as z.ZodOptional<any> // zod-ok
}

export function createPartialShape(shape: Record<string, $ZodType>): Record<string, $ZodType> {
  const partialShape: Record<string, $ZodType> = {}
  for (const [key, value] of Object.entries(shape)) {
    partialShape[key] = ensureOptional(value)
  }
  return partialShape
}

export function createUpdateObjectSchema<Name extends string>(
  name: Name,
  shape: Record<string, $ZodType>
): z.ZodObject<any> {
  return z.object({
    _id: zx.id(name),
    _creationTime: z.optional(z.number()),
    ...createPartialShape(shape)
  })
}

export function createPaginatedDocSchema(docSchema: $ZodType): z.ZodObject<any> {
  return z.object({
    page: z.array(docSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
    pageStatus: z.enum(['SplitRecommended', 'SplitRequired']).nullable().optional()
  })
}

export function createObjectSchemaBundle<Name extends string>(
  name: Name,
  fields: $ZodShape,
  baseSchema: z.ZodObject<any> = z.object(fields)
): RuntimeModelSchemaBundle {
  const docSchema = addSystemFields(name, baseSchema)

  return {
    doc: docSchema,
    base: baseSchema,
    insert: baseSchema,
    update: createUpdateObjectSchema(name, fields),
    docArray: z.array(docSchema),
    paginatedDoc: createPaginatedDocSchema(docSchema)
  }
}

export function createSchemaUpdateSchema<Name extends string>(
  name: Name,
  inputSchema: $ZodType
): $ZodType {
  if (isZodUnion(inputSchema)) {
    const updateOptions = getUnionOptions(inputSchema).map((variant: $ZodType) => {
      if (variant instanceof $ZodObject) {
        return createUpdateObjectSchema(name, variant._zod.def.shape)
      }
      return variant
    })
    return createUnionFromOptions(updateOptions)
  }

  if (inputSchema instanceof $ZodObject) {
    return createUpdateObjectSchema(name, inputSchema._zod.def.shape)
  }

  return inputSchema
}

export function createSchemaBundle<Name extends string>(
  name: Name,
  inputSchema: $ZodType
): RuntimeModelSchemaBundle {
  const docSchema = addSystemFields(name, inputSchema)

  return {
    doc: docSchema,
    base: inputSchema,
    insert: inputSchema,
    update: createSchemaUpdateSchema(name, inputSchema),
    docArray: z.array(docSchema),
    paginatedDoc: createPaginatedDocSchema(docSchema)
  }
}
