// @vitest-environment node
import pg from 'pg'
import { afterEach,expect,it,vi } from 'vitest'

afterEach(()=>{vi.unstubAllEnvs();vi.resetModules()})

it('uses the validated transport for metadata, reader and optional writer without changing read-only policy',async()=>{
  vi.resetModules()
  vi.stubEnv('ADMIN_DATABASE_URL','postgresql://admin:localhost@metadata.example/metadata?sslmode=require&uselibpqcompat=true')
  vi.stubEnv('ADMIN_READ_DATABASE_URL','postgresql://reader:synthetic@reader.example/production?ssl=true')
  vi.stubEnv('ADMIN_PRODUCTION_WRITE_DATABASE_URL','postgresql://writer:synthetic@writer.example/production?sslmode=verify-ca')
  vi.stubEnv('PGSSLMODE','no-verify')
  const db=await import('../db.js')
  try {
    expect(db.writePool).not.toBeNull()
    for(const pool of [db.pool,db.readPool,db.writePool!]) {
      expect(pool.options.ssl).toEqual({rejectUnauthorized:true})
      expect(new pg.Client(pool.options).ssl).toEqual({rejectUnauthorized:true})
    }
    expect(db.readPool.options.options).toBe('-c default_transaction_read_only=on')
    expect(db.pool.options.max).toBe(6)
    expect(db.readPool.options.max).toBe(8)
    expect(db.writePool!.options.max).toBe(4)
  }finally {await db.closePool()}
})
