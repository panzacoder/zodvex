import { z } from 'zod'
import { defineZodModel, zodvexCodec } from '../src'

// validates field paths at type level
{
  const model = defineZodModel('patients', {
    clinicId: z.string(),
    name: z.string()
  })

  // These compile
  model.index('byClinic', ['clinicId'])
  model.index('byName', ['name'])
  model.index('byClinicAndName', ['clinicId', 'name'])
  model.index('byCreation', ['_creationTime'])

  // These would NOT compile:
  // @ts-expect-error — 'bogus' is not a valid field path
  model.index('bad', ['bogus'])
  // @ts-expect-error — 'clinicid' (lowercase) is not a valid field path
  model.index('bad2', ['clinicid'])
}

// validates nested object paths
{
  const model = defineZodModel('locations', {
    name: z.string(),
    address: z.object({
      city: z.string(),
      state: z.string(),
      zip: z.number()
    })
  })

  model.index('byCity', ['address.city'])
  model.index('byState', ['address.state'])
  model.index('byAddress', ['address'])

  // @ts-expect-error — 'address.country' doesn't exist
  model.index('bad', ['address.country'])
}

// validates custom field wire-format paths
{
  const customString = zodvexCodec(
    z.object({
      value: z.string().nullable(),
      status: z.enum(['full', 'hidden']),
      __customField: z.string().optional(),
      reason: z.string().optional()
    }),
    z.custom<{ _brand: 'CustomField' }>(() => true),
    {
      decode: wire => ({ _brand: 'CustomField' as const, ...wire }),
      encode: _field => ({
        value: null,
        status: 'full' as const
      })
    }
  )

  const model = defineZodModel('patients', {
    clinicId: z.string(),
    email: customString
  })

  // Wire-format paths into CustomWire structure
  model.index('byClinic', ['clinicId'])
  model.index('byEmailValue', ['email.value'])
  model.index('byEmailStatus', ['email.status'])

  // @ts-expect-error — 'email.bogus' doesn't exist in CustomWire
  model.index('bad', ['email.bogus'])
}

// handles optional custom fields
{
  const customString = zodvexCodec(
    z.object({
      value: z.string().nullable(),
      status: z.enum(['full', 'hidden'])
    }),
    z.custom<{ _brand: 'CustomField' }>(() => true),
    {
      decode: _wire => ({ _brand: 'CustomField' as const }),
      encode: () => ({ value: null, status: 'full' as const })
    }
  )

  const model = defineZodModel('contacts', {
    name: z.string(),
    email: customString.optional(),
    phone: customString.nullable()
  })

  // Optional/nullable don't block nested path access
  model.index('byEmailValue', ['email.value'])
  model.index('byPhoneValue', ['phone.value'])
}
