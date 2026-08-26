import { useState } from 'react'
import { api } from '../convex/_generated/api'
import { useZodMutation, useZodQuery } from '../convex/_zodvex/client.js'
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
  // useZodQuery (not Convex's useQuery) so the `returns` schema is decoded:
  // `dueDate`/`createdAt` are declared as `zx.date()`, so they arrive here as
  // real `Date` objects instead of the wire-format millisecond timestamps.
  const tasks = useZodQuery(api.tasks.list, {
    paginationOpts: { numItems: 10, cursor: null },
  })
  const [title, setTitle] = useState('')
  // <input type="date"> speaks 'YYYY-MM-DD'; the Date lives at the zodvex boundary.
  const [dueDate, setDueDate] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const createTask = useZodMutation(api.tasks.create)
  const completeTask = useZodMutation(api.tasks.complete)

  // Need a user ID to create tasks — for demo, use the first user.
  // `email` is a `tagged()` codec: runtime { value, tag, displayValue } encodes to
  // wire { value, tag }. useZodQuery applies that encode, so we pass the runtime
  // shape here. Convex's raw useQuery would send `displayValue` through untouched
  // and the server's arg validator rejects it as an extra field.
  const userByEmail = useZodQuery(api.users.getByEmail, {
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
              await createTask({
                title,
                ownerId,
                estimate: { hours: 1, minutes: 0 },
                // `dueDate` is `zx.date().optional()` on the server, so we hand it a
                // real Date — useZodMutation encodes it to a timestamp on the wire.
                // Parsed as local end-of-day so a task due today isn't instantly overdue.
                dueDate: dueDate ? new Date(`${dueDate}T23:59:59`) : undefined,
              })
              setTitle('')
              setDueDate('')
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
          <div>
            <label>
              Due date{' '}
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            {fieldErrors.dueDate && <div style={{ color: 'red', fontSize: '0.8em' }}>{fieldErrors.dueDate}</div>}
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
            {/* zDuration decodes to { hours, minutes } — the wire format is total minutes. */}
            {task.estimate != null && ` (est: ${task.estimate.hours}h ${task.estimate.minutes}m)`}
            {/* task.dueDate is a Date, so plain Date APIs work — no manual `new Date(ms)`. */}
            {task.dueDate != null && (
              <span
                style={{
                  marginLeft: '0.5rem',
                  color:
                    task.status !== 'done' && task.dueDate.getTime() < Date.now() ? 'crimson' : '#666',
                }}
              >
                due {task.dueDate.toLocaleDateString()}
              </span>
            )}
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
