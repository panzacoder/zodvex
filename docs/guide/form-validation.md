# Form Validation

Use zodvex schemas with form libraries like react-hook-form for end-to-end type safety — the same schema validates both your Convex function args and your form inputs. See the [README](../../README.md) for a full overview of zodvex.

## Basic Example with react-hook-form

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import { UserModel } from '../convex/tables/users'

// Create form schema from your model's fields
const CreateUserForm = z.object(UserModel.fields)
type CreateUserForm = z.infer<typeof CreateUserForm>

function UserForm() {
  const createUser = useMutation(api.users.createUser)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<CreateUserForm>({
    resolver: zodResolver(CreateUserForm)
  })

  const onSubmit = async (data: CreateUserForm) => {
    await createUser(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}

      <input {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}

      <button type="submit">Create User</button>
    </form>
  )
}
```

## Codegen Form Resolvers

When using zodvex codegen (`_zodvex/`), pre-built form resolvers are generated for each model. These resolvers are already configured with `zodResolver` and handle codec-aware encoding automatically:

```tsx
// Generated resolver — no manual setup needed
import { userFormResolver } from '../convex/_zodvex/client'

function UserForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: userFormResolver
  })
  // ...
}
```

See the codegen documentation for setup details.

## Using Subset Schemas for Forms

You can also create form schemas from a subset of model fields — useful when a form only covers part of the model:

```tsx
import { z } from 'zod'
import { UserModel } from '../convex/tables/users'

// Only validate the fields the form actually touches
const ProfileForm = z.object({
  name: UserModel.fields.name,
  email: UserModel.fields.email,
})
type ProfileForm = z.infer<typeof ProfileForm>
```

## Date Fields in Forms

`zx.date()` fields store `Date` objects at runtime. For form inputs, you'll typically work with strings and convert:

```tsx
import { zx } from 'zodvex/core'

// Form schema uses string for the input
const EventForm = z.object({
  title: z.string(),
  startDate: z.string(), // HTML date input gives a string
})

// Convert to Date before calling the mutation
const onSubmit = async (data: EventForm) => {
  await createEvent({
    title: data.title,
    startDate: new Date(data.startDate), // zx.date() expects a Date
  })
}
```
