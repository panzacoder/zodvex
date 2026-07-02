import { useState } from 'react'
import { usePaginatedQuery, useQuery, type PaginatedQueryReference } from 'convex/react'
import { createAutoOptimistic } from 'convex-auto-optimistic/react'
import { api } from '../convex/_generated/api'
import { useZodMutation, useZodQuery, encodeArgs, decodeResult } from '../convex/_zodvex/client.js'
import { tableGraph } from './table-graph.generated'
import { ZodError } from 'zod'

// Auto-optimistic hooks: the table graph knows which queries each mutation
// affects; the zodvex boundary helpers encode runtime args (Date, {hours,
// minutes} durations) to the wire shape the local store holds.
const { useAutoMutation } = createAutoOptimistic({
  graph: tableGraph,
  api,
  encodeArgs,
  decodeResult,
})

export default function App() {
  return (
    <div style={{ display: 'flex', gap: '2rem', padding: '1rem', fontFamily: 'system-ui' }}>
      <UserPanel />
      <TaskPanel />
      <PaginatedTaskPanel />
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
  // Predictions are authored in WIRE shape: encodeArgs already ran, so
  // `args` here is Convex-shaped (estimate in minutes, dates as numbers) —
  // matching the values in the optimistic local store. tasks:list is ordered
  // desc, so new docs go at the start of the first page.
  const createTask = useAutoMutation(api.tasks.create, (args) => ({
    kind: 'insert',
    at: 'start',
    doc: {
      _id: `optimistic:${Date.now()}`,
      _creationTime: Date.now(),
      status: 'todo',
      priority: null,
      createdAt: Date.now(),
      ...(args as Record<string, unknown>),
    },
  }))
  const completeTask = useAutoMutation(api.tasks.complete, (args) => ({
    kind: 'patch',
    id: args.id as string,
    changes: { status: 'done', completedAt: Date.now() },
  }))
  const deleteTask = useAutoMutation(api.tasks.remove, (args) => ({
    kind: 'delete',
    id: args.id as string,
  }))

  // Need a user ID to create tasks — for demo, use the first user.
  // useZodQuery encodes runtime-shaped codec args to wire shape (the raw
  // useQuery would send displayValue, which the server validator rejects).
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
            <button onClick={() => deleteTask({ id: task._id })} style={{ marginLeft: '0.5rem' }}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Same tasks table through convex/react's usePaginatedQuery. Its internal
 * query variants (paginationOpts with an extra `id` field, growing pages)
 * are patched by the same auto-optimistic predictions as the raw useQuery
 * panel — create/complete/delete over there update this list instantly too.
 */
function PaginatedTaskPanel() {
  // Cast: zodvex's paginatedDoc types pageStatus as a generic enum string
  // rather than the 'SplitRecommended' | 'SplitRequired' literal union
  // PaginatedQueryReference expects (zodvex type bug — runtime shape is
  // correct). Remove the cast once zx.paginationResult infers literals.
  const { results, status, loadMore } = usePaginatedQuery(
    api.tasks.list as unknown as typeof api.tasks.list & PaginatedQueryReference,
    {},
    { initialNumItems: 5 }
  )

  return (
    <div style={{ flex: 1 }}>
      <h2>Tasks (usePaginatedQuery)</h2>
      <ul>
        {results.map((task) => (
          <li key={task._id}>
            <strong>{task.title}</strong> — {task.status}
          </li>
        ))}
      </ul>
      {status === 'CanLoadMore' && (
        <button onClick={() => loadMore(5)}>Load more</button>
      )}
      {status === 'LoadingFirstPage' && <p>Loading…</p>}
    </div>
  )
}
