// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'

const state=vi.hoisted(()=>({db:null as PGlite|null}))
vi.mock('../db.js',()=>({
  pool:{query:(sql:string,params?:unknown[])=>state.db!.query(sql,params)},
  readPool:{query:(sql:string,params?:unknown[])=>state.db!.query(sql,params)},
}))

describe('Business venue audit SQL isolation',()=>{
  beforeAll(async()=>{
    state.db=new PGlite()
    await state.db.exec(`
      CREATE TABLE admin_accounts(id BIGINT PRIMARY KEY,display_name TEXT,email TEXT);
      CREATE TABLE companies(id BIGINT PRIMARY KEY,name TEXT);
      CREATE TABLE venues(id BIGINT PRIMARY KEY,company_id BIGINT,name TEXT);
      CREATE TABLE admin_audit_log(
        id BIGSERIAL PRIMARY KEY,admin_id BIGINT,company_id BIGINT,venue_id BIGINT,
        action TEXT,entity_type TEXT,entity_id TEXT,before_value JSONB,after_value JSONB,
        reason TEXT,admin_role TEXT,metadata JSONB,created_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO companies VALUES(10,'Company A'),(20,'Company B');
      INSERT INTO venues VALUES(101,10,'Venue A1'),(102,10,'Venue A2'),(201,20,'Venue B1');
      INSERT INTO admin_audit_log(company_id,venue_id,action) VALUES
        (10,101,'audit.venue101'),(10,102,'audit.venue102'),
        (20,201,'audit.foreign'),(10,NULL,'audit.company');
    `)
  })
  afterAll(async()=>{await state.db?.close()})

  const scope=(id:string)=>({
    id,companyId:'10',companyCode:'company-a',companyName:'Company A',
    code:'venue',name:'Venue',address:null,legacyBarId:null,
  })

  it('returns only the selected venue within the same company',async()=>{
    const {getAdminAudit}=await import('../admin-metadata-read.js')
    const first=await getAdminAudit(scope('101'))
    const second=await getAdminAudit(scope('102'))
    expect(first.rows.map(row=>row.action)).toEqual(['audit.venue101'])
    expect(second.rows.map(row=>row.action)).toEqual(['audit.venue102'])
  })

  it('preserves unscoped global audit including company-level entries',async()=>{
    const {getAdminAudit}=await import('../admin-metadata-read.js')
    const global=await getAdminAudit(null)
    expect(new Set(global.rows.map(row=>row.action))).toEqual(new Set([
      'audit.venue101','audit.venue102','audit.foreign','audit.company',
    ]))
  })
})
