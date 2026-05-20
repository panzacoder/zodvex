import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex'
import { zDuration } from '../codecs'
import { taggedEmail, taggedTag } from '../tagged'

/**
 * Discriminated union payloads — codecs are nested inside variant shapes.
 * This is the pattern that requires recursive codec discovery:
 *   model.schema.doc.shape.payload → z.union([...]) → variant.shape.duration → zDuration
 */
const TaskCompletedPayload = z.object({
  type: z.literal('task_completed'),
  taskId: zx.id('tasks'),
  duration: zDuration,
})

const UserInvitedPayload = z.object({
  type: z.literal('user_invited'),
  email: taggedEmail,  // shared codec instance — same one user.ts uses
})

export const activityFields = {
  actorId: zx.id('users'),
  payload: z.union([TaskCompletedPayload, UserInvitedPayload]),
  tags: z.array(taggedTag).optional(),  // shared codec instance for activity tags
  createdAt: zx.date(),
}

export const ActivityModel = defineZodModel('activities', activityFields)
  .index('by_actor', ['actorId'])
  .index('by_created', ['createdAt'])
