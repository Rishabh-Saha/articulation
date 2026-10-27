import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const directory = resolve(process.env.ARTICULATION_EMULATOR_DIR || '.cache/emulators')
const jar = resolve(directory, 'platform/cloud-firestore-emulator/cloud-firestore-emulator.jar')
if (!existsSync(jar))
  throw Error('Run npm run setup:emulators first (requires Python 3.12+ and Java 21+).')
const children = [
  // This is the official launcher's Java entry point. Spawn it directly so
  // shutdown signals reach the JVM rather than leaving an orphan subprocess.
  spawn(
    'java',
    [
      '-Duser.language=en',
      '-cp',
      jar,
      'com.google.cloud.datastore.emulator.firestore.CloudFirestore',
      '--host=127.0.0.1',
      '--port=8085',
      '--project_id=demo-articulation',
      `--rules=${resolve('firestore.rules')}`,
    ],
    { stdio: 'inherit' },
  ),
  spawn(
    process.execPath,
    [
      'node_modules/firebase-tools/lib/bin/firebase.js',
      'emulators:start',
      '--only',
      'auth',
      '--project',
      'demo-articulation',
    ],
    { stdio: 'inherit' },
  ),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  children.forEach((c) => c.kill('SIGTERM'))
  process.exitCode = code
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
children.forEach((child) => {
  child.on('error', (error) => {
    console.error(error.message)
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1)
  })
})
