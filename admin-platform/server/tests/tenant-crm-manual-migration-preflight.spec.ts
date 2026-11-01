// @vitest-environment node
// Verification is strictly SELECT-only against disposable PGlite, no live DB.
import fs from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {describe,it,expect} from 'vitest'
import {inspectManualCrmMigrationTarget,type ManualCrmMigrationExpectation}
  from '../tenant-crm-manual-migration-preflight.js'

async function fixture(options:{ownership?:boolean;binding?:boolean}={}){
  const db=new PGlite()
  await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY);')
  for(const name of ['017_spaceverse_runtime_binding.sql',
    '018_spaceverse_runtime_scope_binding.sql',
    ...(options.ownership===false?[]:['019_spaceverse_customer_ownership.sql'])])
    await db.exec(await fs.readFile(new URL('../../../migrations/'+name,import.meta.url),'utf8'))
  const expectation:ManualCrmMigrationExpectation={
    databaseName:(await db.query<{name:string}>('SELECT current_database() AS name')).rows[0]!.name,
    runtimeKey:'sv-'+'a'.repeat(32),manifestSha256:'b'.repeat(64),
    manifestRevision:1,companyId:'10',venueId:'20',
  }
  if(options.binding!==false)await db.query(`INSERT INTO spaceverse_runtime_binding
    (singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status)
    VALUES(TRUE,$1,$2,1,$3,$4,'dedicated_database','prepared')`,
    [expectation.runtimeKey,expectation.manifestSha256,expectation.companyId,expectation.venueId])
  return {db,expectation}
}

describe('CHAT03 #24 migration 002 read-only tenant target preflight',()=>{
  it('reports review required for exact prepared scope without mutating the target',async()=>{
    const {db,expectation}=await fixture()
    try{
      const commands:string[]=[]
      const selectOnly={query:async<Row=Record<string,unknown>>(sql:string,params?:unknown[])=>{
        commands.push(sql)
        if(!/^SELECT\b/i.test(sql.trim()))throw new Error('Write attempted by preflight')
        return db.query<Row>(sql,params)
      }}
      const result=await inspectManualCrmMigrationTarget(selectOnly,expectation)
      expect(result).toEqual({
        state:'review_required',databaseName:expectation.databaseName,
        runtimeKey:expectation.runtimeKey,companyId:'10',venueId:'20',
        manifestRevision:1,approvalGranted:false,
      })
      expect(commands).toHaveLength(2)
      expect(commands.every(sql=>/^SELECT\b/i.test(sql.trim()))).toBe(true)
      expect((await db.query<{name:string|null}>(`SELECT to_regclass('public.spaceverse_crm_contacts')::text AS name`))
        .rows[0]?.name).toBeNull()
    }finally{await db.close()}
  })
  it('rejects another database, changed manifest, or a different company/venue',async()=>{
    const {db,expectation}=await fixture()
    try{
      for(const changed of [
        {databaseName:'foreign_database'},
        {runtimeKey:'sv-'+'c'.repeat(32)},
        {manifestSha256:'d'.repeat(64)},
        {manifestRevision:2},
        {companyId:'11'},
        {venueId:'21'},
      ])await expect(inspectManualCrmMigrationTarget(db,{...expectation,...changed}))
        .rejects.toMatchObject({code:changed.databaseName?'DATABASE_MISMATCH':'BINDING_MISMATCH_OR_NOT_PREPARED'})
    }finally{await db.close()}
  })
  it('refuses missing ownership migration or missing prepared binding',async()=>{
    for(const options of [{ownership:false},{binding:false}]){
      const {db,expectation}=await fixture(options)
      try{
        await expect(inspectManualCrmMigrationTarget(db,expectation))
          .rejects.toMatchObject({code:options.ownership===false?'PREREQUISITES_MISSING':'BINDING_MISSING_OR_AMBIGUOUS'})
      }finally{await db.close()}
    }
  })
  it('stops if the migration is already present, never guesses a second application',async()=>{
    const {db,expectation}=await fixture()
    try{
      await db.exec("SET spaceverse.crm_contacts_migration='approved'")
      await db.exec(await fs.readFile(new URL('../tenant-migrations/002_manual_crm_contacts.sql',import.meta.url),'utf8'))
      await expect(inspectManualCrmMigrationTarget(db,expectation))
        .rejects.toMatchObject({code:'MIGRATION_ALREADY_OR_PARTIALLY_PRESENT'})
    }finally{await db.close()}
  })
  it('rejects malformed input before reading database or retrieving credentials',async()=>{
    let calls=0
    const target={query:async()=>{calls++;return {rows:[]}}}
    await expect(inspectManualCrmMigrationTarget(target,{
      databaseName:'',runtimeKey:'not-a-runtime',manifestSha256:'0',
      manifestRevision:0,companyId:'0',venueId:'0',
    })).rejects.toMatchObject({code:'INVALID_EXPECTATION'})
    expect(calls).toBe(0)
  })
})
