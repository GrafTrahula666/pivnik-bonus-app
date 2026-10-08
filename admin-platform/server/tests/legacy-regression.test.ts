
import fs from 'node:fs'
import { describe,expect,it } from 'vitest'

describe('customer runtime isolation regression guard',()=>{
  const server=fs.readFileSync('server/index.ts','utf8')
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'))
  const migrations=fs.readdirSync('admin-migrations').map(name=>fs.readFileSync(`admin-migrations/${name}`,'utf8')).join('\n')
  it('Admin has a separate process entrypoint',()=>expect(pkg.scripts.start).toBe('node dist-server/index.js'))
  it('Admin rejects non-admin API namespaces',()=>{
    expect(server).toContain("url.pathname.startsWith('/api/')")
    expect(server).toContain('NON_ADMIN_API_REJECTED')
  })
  it('Admin migrations do not destructively alter legacy customer tables',()=>{
    expect(migrations).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i)
    expect(migrations).not.toMatch(/\bALTER\s+TABLE\s+(?:users|wallets|transactions|bars|bar_customers|user_identities)\b/i)
  })
})
