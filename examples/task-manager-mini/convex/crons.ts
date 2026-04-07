import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Run a daily cleanup of completed tasks
crons.daily(
  'cleanup completed tasks',
  { hourUTC: 4, minuteUTC: 0 },
  internal.notifications.cleanupOld,
  {}
)

export default crons
