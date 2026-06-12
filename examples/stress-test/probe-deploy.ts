import { deploy } from './realDeploy.js'
const r = await deploy({ source: 'tmp/zodvex/composed', verbose: false })
console.log('deploy:', r.kind)
