import fs from 'node:fs'
import path from 'node:path'

const target = path.resolve('server/data.ts')
const source = fs.readFileSync(target, 'utf8')
const marker = 'export async function getOperations(scope: VenueScope, url: URL) {'
const start = source.indexOf(marker)
if (start < 0) throw new Error('getOperations marker not found')
const end = source.indexOf('\nexport async function ', start + marker.length)
const before = source.slice(0, start)
const block = source.slice(start, end < 0 ? source.length : end)
const after = end < 0 ? '' : source.slice(end)

const oldFilter = "     WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL\n       AND u.role = 'client'\n"
const newFilter = "     WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL\n"

if (block.includes(oldFilter)) {
  const patched = block.replace(oldFilter, newFilter)
  fs.writeFileSync(target, before + patched + after)
  console.log('Patched Admin Operations visibility: service-role transaction targets are included.')
} else if (block.includes(newFilter) && !block.includes("AND u.role = 'client'")) {
  console.log('Admin Operations visibility already patched.')
} else {
  throw new Error('Expected getOperations role filter not found; refusing broad replacement.')
}
