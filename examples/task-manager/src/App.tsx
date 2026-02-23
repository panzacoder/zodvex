import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'

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
  const createUser = useMutation(api.users.create)

  return (
    <div style={{ flex: 1 }}>
      <h2>Users</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          await createUser({ name, email })
          setName('')
          setEmail('')
        }}
      >
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit">Create User</button>
      </form>
    </div>
  )
}

function TaskPanel() {
  const tasks = useQuery(api.tasks.list, {
    paginationOpts: { numItems: 10, cursor: null },
  })
  const [title, setTitle] = useState('')
  const createTask = useMutation(api.tasks.create)
  const completeTask = useMutation(api.tasks.complete)

  // Need a user ID to create tasks — for demo, use the first user
  const userByEmail = useQuery(api.users.getByEmail, { email: 'demo@example.com' })
  const ownerId = userByEmail?._id

  return (
    <div style={{ flex: 2 }}>
      <h2>Tasks</h2>

      {ownerId && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            await createTask({ title, ownerId, estimate: 60 })
            setTitle('')
          }}
        >
          <input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit">Add Task</button>
        </form>
      )}

      {!ownerId && <p>Create a user with email "demo@example.com" first</p>}

      <ul>
        {tasks?.page?.map((task: any) => (
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
