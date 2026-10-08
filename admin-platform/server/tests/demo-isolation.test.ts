
import fs from 'node:fs'
import { describe,expect,it } from 'vitest'

describe('Sales Demo isolation',()=>{
  const source=fs.readFileSync('src/phaseC/DemoMode.tsx','utf8')
  it('never calls production Admin write API',()=>{
    expect(source).not.toContain('apiPost(')
    expect(source).not.toContain('apiPut(')
    expect(source).not.toContain('/api/admin/')
  })
  it('is visibly marked as synthetic',()=>{
    expect(source).toContain('ДЕМО-РЕЖИМ')
    expect(source).toContain('ПРИМЕР ДАННЫХ')
    expect(source).toContain('ИЗМЕНЕНИЯ НЕ СОХРАНЯЮТСЯ')
  })
})
