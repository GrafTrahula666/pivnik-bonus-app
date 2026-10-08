import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const steps = [
  ['staging:preflight', 'Synthetic legacy schema'],
  ['db:migrate', 'Clean Admin migration'],
  ['db:migrate', 'Repeat Admin migration'],
  ['seed:test-tenant', 'Synthetic tenant seed'],
  ['staging:verify', 'Migration and schema verification'],
  ['staging:integration', 'PostgreSQL integration tests'],
]

for (const [script, label] of steps) {
  console.log(`\n[staging-deploy] ${label}`)
  const result = spawnSync(npm, ['run', script], {
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`[staging-deploy] ${label} failed with status ${result.status ?? 'unknown'}.`)
    process.exit(result.status ?? 1)
  }
}

console.log('\nSTAGING_DEPLOY PASS: schema, seed, verification, and integration checks completed.')
