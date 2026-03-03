import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useZodMutation } from '../convex/_zodvex/client'
import { ZodError } from 'zod'

export default function App() {
  return (
    <div style={{ display: 'flex', gap: '2rem', padding: '1rem', fontFamily: 'system-ui' }}>
      <UserPanel />
      <TaskPanel />
    </div>
  )
}

function UserPanel() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const createUser = useZodMutation(api.users.create)

  return (
    <div style={{ flex: 1 }}>
      <h2>Users</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setFieldErrors({})
          setError(null)
          try {
            await createUser({ name, email })
            setName('')
            setEmail('')
          } catch (err) {
            if (err instanceof ZodError) {
              // safeEncode normalizes codec paths — no wire-internal segments
              const errors: Record<string, string> = {}
              for (const issue of err.issues) {
                const field = issue.path.join('.')
                errors[field] = issue.message
              }
              setFieldErrors(errors)
            } else {
              setError(err instanceof Error ? err.message : 'Unknown error')
            }
          }
        }}
      >
        <div>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          {fieldErrors.name && <div style={{ color: 'red', fontSize: '0.8em' }}>{fieldErrors.name}</div>}
        </div>
        <div>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {fieldErrors.email && <div style={{ color: 'red', fontSize: '0.8em' }}>{fieldErrors.email}</div>}
        </div>
        <button type="submit">Create User</button>
        {error && <div style={{ color: 'red' }}>{error}</div>}
      </form>
    </div>
  )
}

function TaskPanel() {
  const tasks = useQuery(api.tasks.list, {
    paginationOpts: { numItems: 10, cursor: null },
  })
  const [title, setTitle] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const createTask = useZodMutation(api.tasks.create)
  const completeTask = useZodMutation(api.tasks.complete)

  // Need a user ID to create tasks — for demo, use the first user
  // NOTE: Convex's useQuery sees runtime types for codec args (ArgsInput uses z.output).
  // This is a known zodvex type gap — callers should ideally pass wire format { value, tag }.
  const userByEmail = useQuery(api.users.getByEmail, {
    email: { value: 'demo@example.com', tag: 'email', displayValue: '[email] demo@example.com' },
  })
  const ownerId = userByEmail?._id

  return (
    <div style={{ flex: 2 }}>
      <h2>Tasks</h2>

      {ownerId && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setFieldErrors({})
            setError(null)
            try {
              await createTask({ title, ownerId, estimate: { hours: 1, minutes: 0 } })
              setTitle('')
            } catch (err) {
              if (err instanceof ZodError) {
                const errors: Record<string, string> = {}
                for (const issue of err.issues) {
                  const field = issue.path.join('.')
                  errors[field] = issue.message
                }
                setFieldErrors(errors)
              } else {
                setError(err instanceof Error ? err.message : 'Unknown error')
              }
            }
          }}
        >
          <div>
            <input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            {fieldErrors.title && <div style={{ color: 'red', fontSize: '0.8em' }}>{fieldErrors.title}</div>}
          </div>
          <button type="submit">Add Task</button>
          {error && <div style={{ color: 'red' }}>{error}</div>}
        </form>
      )}

      {!ownerId && <p>Create a user with email "demo@example.com" first</p>}

      <ul>
        {tasks?.page?.map((task) => (
          <li key={task._id}>
            <strong>{task.title}</strong> — {task.status}
            {task.estimate != null && ` (est: ${task.estimate} min)`}
            {task.status !== 'done' && (
              <button onClick={() => completeTask({ id: task._id })} style={{ marginLeft: '0.5rem' }}>
                Complete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
