import { readFileSync } from 'node:fs'
import { expect,it } from 'vitest'

it('keys Business content by mode, admin identity and selected tenant/venue',()=>{
  const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8')
  expect(source).toContain('className="content" key={')
  expect(source).toContain('session.admin.id')
  expect(source).toContain('selected?.companyId')
  expect(source).toContain('selected?.id')
  expect(source).toContain('allVenues?"all":"none"')
})
