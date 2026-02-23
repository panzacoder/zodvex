import { defineZodSchema } from 'zodvex'
import { UserModel } from './models/user'
import { TaskModel } from './models/task'
import { CommentModel } from './models/comment'

export default defineZodSchema({
  users: UserModel,
  tasks: TaskModel,
  comments: CommentModel,
})
