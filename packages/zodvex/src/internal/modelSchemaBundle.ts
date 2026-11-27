import { z } from 'zod'
import { id } from './schema/id'
import {
  addSystemFields,
  createUnionFromOptions,
  getUnionOptions,
  isZodUnion
} from './schemaHelpers'
import { $ZodNullable, $ZodObject, $ZodOptional, type $ZodShape, $ZodType } from './zod-core'

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

/** Wrap in .nullable().optional() using core constructors for zod-mini compat. */
function nullableOptional(schema: $ZodType): $ZodType {
  return new $ZodOptional({
    type: 'optional',
    innerType: new $ZodNullable({ type: 'nullable', innerType: schema })
  }) as any
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
    _id: id(name),
    _creationTime: z.optional(z.number()),
    ...createPartialShape(shape)
  })
}

export function createPaginatedDocSchema(docSchema: $ZodType): z.ZodObject<any> {
  return z.object({
    page: z.array(docSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: nullableOptional(z.string()),
    pageStatus: nullableOptional(z.enum(['SplitRecommended', 'SplitRequired']))
  })
}

/**
 * Completes a bundle with `update`, `docArray` and `paginatedDoc` as memoizing getters, so a
 * model that never reads them never builds them. Own and enumerable, like the eager keys.
 */
function withDerivedSchemas(
  eager: Pick<RuntimeModelSchemaBundle, 'doc' | 'base' | 'insert'>,
  buildUpdate: () => $ZodType
): RuntimeModelSchemaBundle {
  const onFirstRead = (build: () => $ZodType): PropertyDescriptor => {
    let built: $ZodType | undefined
    return {
      enumerable: true,
      configurable: true,
      get: () => {
        built ??= build()
        return built
      }
    }
  }
  return Object.defineProperties(eager, {
    update: onFirstRead(buildUpdate),
    docArray: onFirstRead(() => z.array(eager.doc)),
    paginatedDoc: onFirstRead(() => createPaginatedDocSchema(eager.doc))
  }) as RuntimeModelSchemaBundle
}

export function createObjectSchemaBundle<Name extends string>(
  name: Name,
  fields: $ZodShape,
  baseSchema: z.ZodObject<any> = z.object(fields)
): RuntimeModelSchemaBundle {
  const docSchema = addSystemFields(name, baseSchema)

  return withDerivedSchemas({ doc: docSchema, base: baseSchema, insert: baseSchema }, () =>
    createUpdateObjectSchema(name, fields)
  )
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

  return withDerivedSchemas({ doc: docSchema, base: inputSchema, insert: inputSchema }, () =>
    createSchemaUpdateSchema(name, inputSchema)
  )
}
