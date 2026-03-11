import { defineZodSchema } from 'zodvex'
import { UserModel } from './models/user'
import { TaskModel } from './models/task'
import { CommentModel } from './models/comment'
import { ActivityModel } from './models/activity'

export default defineZodSchema({
  users: UserModel,
  tasks: TaskModel,
  comments: CommentModel,
  activities: ActivityModel,
})
