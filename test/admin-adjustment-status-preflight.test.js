import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createAdminAdjustmentStatusPreflight } from '../admin-adjustment-status-preflight.js';

async function fixture(t, { attribution=true, memberships=true }={}) {
  const db=new PGlite();t.after(()=>db.close());
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  for (const table of ['users','transactions']) {
    const ddl=source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(ddl);await db.exec(ddl[0]);
  }
  if (attribution) await db.exec(await readFile(new URL('../migrations/009_spaceverse_tenant_attribution.sql',import.meta.url),'utf8'));
  // Repository read contract only; deliberately not a production migration.
  if (memberships) await db.exec('CREATE TABLE spaceverse_memberships(user_id BIGINT,tenant_id TEXT,location_id TEXT,role TEXT,revoked_at TIMESTAMPTZ)');
  const calls=[];
  return {db,calls,inspect:createAdminAdjustmentStatusPreflight({query:async(sql,params)=>{calls.push({sql,params});return db.query(sql,params);}})};
}

test('Preflight missing schema reports columns without attempting attribution data reads', async t=>{
  for (const options of [{attribution:false,memberships:false},{memberships:false}]) {
    const h=await fixture(t,options),r=await h.inspect();
    assert.equal(r.schemaCompatible,false);assert.equal(r.activationApproved,false);assert.equal(r.counts,null);
    assert.ok(r.missing.includes('spaceverse_memberships.user_id'));
    if (options.attribution===false) assert.ok(r.missing.includes('transactions.tenant_id'));
    assert.equal(h.calls.length,1);
  }
});

test('Preflight incompatible types fail before data queries',async t=>{
  const h=await fixture(t);await h.db.exec('ALTER TABLE spaceverse_memberships ALTER COLUMN user_id TYPE TEXT');
  const r=await h.inspect();assert.equal(r.schemaCompatible,false);
  assert.deepEqual(r.incompatible,['spaceverse_memberships.user_id']);assert.equal(h.calls.length,1);
});

test('Preflight counts incomplete attribution/malformed memberships without disclosing or changing rows',async t=>{
  const h=await fixture(t);
  await h.db.exec(`INSERT INTO users(id,first_name) VALUES(10,'Fixture');
    INSERT INTO transactions(request_key,client_id,mode,status,tenant_id,location_id) VALUES
      ('a',10,'adjustment','completed','tenant-a','loc-a'),('b',10,'adjustment','completed',NULL,NULL),
      ('c',10,'adjustment','completed',NULL,'loc-a'),('d',10,'adjustment','completed','tenant-a',NULL),
      ('e',10,'adjustment','completed',' ','loc-a'),('f',10,'accrue','completed',NULL,NULL);
    INSERT INTO spaceverse_memberships VALUES(10,'tenant-a',NULL,'owner',NULL),(10,'tenant-a','loc-a','staff',NULL),
      (10,'tenant-a','loc-a','owner',NULL),(10,'tenant-a',NULL,'staff',NULL),(10,'tenant-a',NULL,'admin',NULL),
      (10,'tenant-a',NULL,'admin',NOW());`);
  const snapshot=async()=>({users:(await h.db.query('SELECT * FROM users')).rows,
    journal:(await h.db.query('SELECT * FROM transactions ORDER BY request_key')).rows,
    memberships:(await h.db.query('SELECT * FROM spaceverse_memberships')).rows});
  const before=await snapshot();
  for(let n=0;n<2;n++){
    const r=await h.inspect();assert.equal(r.schemaCompatible,true);assert.equal(r.activationApproved,false);
    assert.deepEqual(r.counts,{adjustments:'5',scoped_adjustments:'1',incomplete_attribution:'4',location_without_tenant:'2',active_memberships:'5',malformed_active_memberships:'3'});
    assert.deepEqual(Object.keys(r).sort(),['activationApproved','counts','incompatible','missing','schemaCompatible']);
  }
  assert.deepEqual(await snapshot(),before);
  for(const call of h.calls)assert.doesNotMatch(call.sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b/);
});

test('Preflight compatible empty schema is not activation approval',async t=>{
  const h=await fixture(t),r=await h.inspect();assert.equal(r.schemaCompatible,true);assert.equal(r.activationApproved,false);
  assert.ok(Object.values(r.counts).every(value=>value==='0'));
});

test('Preflight propagates external failures and rejects malformed counts',async()=>{
  assert.throws(()=>createAdminAdjustmentStatusPreflight(),TypeError);
  const outage=Error('SQL down');await assert.rejects(createAdminAdjustmentStatusPreflight({query:async()=>{throw outage;}})(),error=>error===outage);
  await assert.rejects(createAdminAdjustmentStatusPreflight({query:async()=>({rows:null})})(),/Invalid schema/);
  const schemaRows=Object.entries({transactions:{tenant_id:'text',location_id:'text'},spaceverse_memberships:{user_id:'bigint',tenant_id:'text',location_id:'text',role:'text',revoked_at:'timestamp with time zone'}})
    .flatMap(([table_name,columns])=>Object.entries(columns).map(([column_name,data_type])=>({table_name,column_name,data_type})));
  const counts={adjustments:'1',scoped_adjustments:'1',incomplete_attribution:'0',location_without_tenant:'0',active_memberships:'0',malformed_active_memberships:'0'};
  for(const changes of [{adjustments:-1},{adjustments:Number.MAX_SAFE_INTEGER+1},{adjustments:'2'}, {scoped_adjustments:null}, {malformed_active_memberships:'1'}]) {
    let n=0;
    const inspect=createAdminAdjustmentStatusPreflight({query:async()=>({rows:n++===0?schemaRows:[{...counts,...changes}]})});
    await assert.rejects(inspect(),/Invalid audit count|Inconsistent audit counts/);
  }
});
