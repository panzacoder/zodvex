import { spawn } from 'node:child_process'
import path from 'node:path'

const WARNING_FRAGMENT = 'imported from external module "zod/v4/core" but never used'

function localBin(name) {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  return path.join(process.cwd(), 'node_modules', '.bin', `${name}${suffix}`)
}

function writeFiltered(stream, chunk) {
  const text = chunk.toString()
  const filtered = text
    .split('\n')
    .filter(line => !line.includes(WARNING_FRAGMENT))
    .join('\n')

  if (filtered.length > 0) {
    stream.write(filtered)
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe']
    })

    child.stdout.on('data', chunk => writeFiltered(process.stdout, chunk))
    child.stderr.on('data', chunk => writeFiltered(process.stderr, chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${path.basename(command)} exited with code ${code ?? 1}`))
      }
    })
  })
}

await run(localBin('tsup'), [])
await run(localBin('tsc'), ['--emitDeclarationOnly'])
