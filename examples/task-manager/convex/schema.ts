import { zodTable, defineZodSchema } from 'zodvex'
import { userFields } from './models/user'
import { taskFields } from './models/task'
import { commentFields } from './models/comment'

const Users = zodTable('users', userFields)
const Tasks = zodTable('tasks', taskFields)
const Comments = zodTable('comments', commentFields)

export default defineZodSchema({
  users: {
    ...Users,
    table: Users.table.index('by_email', ['email']),
  },
  tasks: {
    ...Tasks,
    table: Tasks.table
      .index('by_owner', ['ownerId'])
      .index('by_status', ['status'])
      .index('by_assignee', ['assigneeId']),
  },
  comments: {
    ...Comments,
    table: Comments.table.index('by_task', ['taskId']),
  },
})
