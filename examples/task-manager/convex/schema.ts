import { defineZodSchema } from 'zodvex/server'
import { UserModel } from './models/user'
import { TaskModel } from './models/task'
import { CommentModel } from './models/comment'
import { ActivityModel } from './models/activity'
import { NotificationModel } from './models/notification'
import { TaskCountModel, TriggerLogModel } from './models/triggerCompose'

export default defineZodSchema({
  users: UserModel,
  tasks: TaskModel,
  comments: CommentModel,
  activities: ActivityModel,
  notifications: NotificationModel,
  triggerLog: TriggerLogModel,
  taskCounts: TaskCountModel,
})
