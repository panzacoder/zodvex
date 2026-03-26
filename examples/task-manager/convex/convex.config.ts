import { defineApp } from 'convex/server'
import actionRetrier from '@convex-dev/action-retrier/convex.config'

const app = defineApp()

// Published component
app.use(actionRetrier)

// Local/custom component would be defined here in a real project:
// import analytics from '../components/analytics/convex.config'
// app.use(analytics)

export default app
