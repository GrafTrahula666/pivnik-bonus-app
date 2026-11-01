import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

import {createSpaceverseRuntimeManifest,resolveSpaceverseRuntime} from '../spaceverse-runtime-manifest.js';
import {createSpaceverseManualCrmContactService,manualCrmContactContract} from '../crm-manual-contact-create.js';

const MIGRATIONS=['017_spaceverse_runtime_binding.sql','018_spaceverse_runtime_scope_binding.sql',
  '019_spaceverse_customer_ownership.sql'];
const MANUAL=new URL('../admin-platform/tenant-migrations/002_manual_crm_contacts.sql',import.meta.url);

async function fixture(seed='a',companyId='50',venueId='51') {
  const db=new PGlite();
  await db.exec('CREATE TABLE users(id BIGSERIAL PRIMARY KEY);');
  for(const name of MIGRATIONS)await db.exec(await fs.readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const draftId=`${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(12)}`;
  const runtimeKey='sv-'+seed.repeat(32);
  const manifest=createSpaceverseRuntimeManifest({draftId,runtimeKey,draftRevision:1,applicationRevision:1,
    scopeRevision:1,scope:{companyId,venueId},
    config:{displayName:'Contact Fixture',theme:'dark',primaryColor:'#112233',
      secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:false}});
  await db.query(`INSERT INTO spaceverse_runtime_binding
    (singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status)
    VALUES(TRUE,$1,$2,1,$3,$4,'dedicated_database','prepared')`,
  [runtimeKey,manifest.manifestSha256,companyId,venueId]);
  await db.exec("SET spaceverse.crm_contacts_migration='approved'");
  await db.exec(await fs.readFile(MANUAL,'utf8'));
  const runtime=await resolveSpaceverseRuntime({environment:{SPACEVERSE_RUNTIME_MODE:'tenant',
    SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest)},query:db.query.bind(db)});
  const connect=async()=>({query:db.query.bind(db),release(){}});
  return {db,runtime,connect};
}
const key=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const contact=(requestKey=key(1),overrides={})=>({requestKey,contact:{
  firstName:'  Анна  ',lastName:'Тест',phone:'+7 (999) 111-22-33',
  email:' ANNA@EXAMPLE.COM ',...overrides}});

test('manual CRM contact migration is explicit, additive, and never provisions app identity',async()=>{
  const sql=await fs.readFile(MANUAL,'utf8');
  assert.match(sql,/spaceverse\.crm_contacts_migration/);
  assert.match(sql,/spaceverse_crm_contacts_phone_uq/);
  assert.match(sql,/spaceverse_crm_contacts_email_uq/);
  assert.equal((sql.match(/^COMMIT;$/gm)||[]).length,1);
  assert.equal(sql.slice(sql.indexOf('\nCOMMIT;\n')+9).trim(),'');
  assert.doesNotMatch(sql,/^\s*(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/im);
  const db=new PGlite();
  try {
    await db.exec('CREATE TABLE users(id BIGSERIAL PRIMARY KEY);');
    for(const name of MIGRATIONS)await db.exec(await fs.readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
    await assert.rejects(db.exec(sql),/Explicit reviewed CRM contact migration required/);
    await db.exec('ROLLBACK');
    await db.exec("SET spaceverse.crm_contacts_migration='approved'");
    await db.exec(sql);await db.exec(sql);
    assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_crm_contacts')).rows[0].count,0);
  } finally {await db.close();}
});

test('single transaction creates only a normalized, unlinked tenant contact',async()=>{
  const {db,runtime,connect}=await fixture();
  try {
    const create=createSpaceverseManualCrmContactService({runtime,connect});
    const row=await create(contact());
    assert.equal(row.contact.id,'1');
    assert.equal(row.contact.firstName,'Анна');
    assert.equal(row.contact.phone,'+79991112233');
    assert.equal(row.contact.email,'anna@example.com');
    assert.equal(row.contact.identityStatus,'unlinked');
    assert.equal(row.contact.walletStatus,'not_created');
    assert.deepEqual((await db.query('SELECT first_name,last_name,phone_e164,email_normalized FROM spaceverse_crm_contacts')).rows,
      [{first_name:'Анна',last_name:'Тест',phone_e164:'+79991112233',email_normalized:'anna@example.com'}]);
    assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count,0);
    assert.equal(manualCrmContactContract.productionWiringEnabled,false);
    assert.equal(manualCrmContactContract.identityLinking,false);
  } finally {await db.close();}
});

test('exact request replay is idempotent while conflicting replay and duplicates fail closed',async()=>{
  const {db,runtime,connect}=await fixture('b');
  try {
    const create=createSpaceverseManualCrmContactService({runtime,connect});
    const first=await create(contact(key(2)));
    assert.deepEqual(await create(contact(key(2))),first);
    await assert.rejects(create(contact(key(2),{firstName:'Пётр'})),{code:'SPACEVERSE_CRM_CONTACT_REPLAY_CONFLICT'});
    await assert.rejects(create(contact(key(3),{email:'another@example.com'})),
      {code:'SPACEVERSE_CRM_CONTACT_DUPLICATE'});
    await assert.rejects(create(contact(key(4),{phone:'+79110002233'})),
      {code:'SPACEVERSE_CRM_CONTACT_DUPLICATE'});
    assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_crm_contacts')).rows[0].count,1);
    assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_crm_contact_create_requests')).rows[0].count,1);
  } finally {await db.close();}
});

test('invalid data and request-derived tenant scope never touch the DB',async()=>{
  const {db,runtime}=await fixture('c');
  let queries=0;
  const create=createSpaceverseManualCrmContactService({runtime,connect:async()=>({
    query:async()=>{queries++;throw new Error('unexpected SQL');},release(){}})});
  try {
    for(const raw of [
      { ...contact(key(5)),companyId:'999'},
      contact('wrong key'),
      contact(key(5),{phone:'123',email:''}),
      contact(key(5),{phone:null,email:null}),
      contact(key(5),{firstName:'\u0000',phone:'+79991112233'}),
      contact(key(5),{email:'invalid@@email'})
    ]) await assert.rejects(create(raw));
    assert.equal(queries,0);
    assert.throws(()=>createSpaceverseManualCrmContactService({runtime:{...runtime},connect:async()=>{}}),
      {code:'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'});
  } finally {await db.close();}
});

test('separate company/venue fixtures never adopt identical contact details across tenants',async()=>{
  const left=await fixture('d','50','51'),right=await fixture('e','60','61');
  try {
    const first=await createSpaceverseManualCrmContactService({runtime:left.runtime,connect:left.connect})(contact(key(6)));
    const second=await createSpaceverseManualCrmContactService({runtime:right.runtime,connect:right.connect})(contact(key(6)));
    assert.equal(first.contact.id,'1');assert.equal(second.contact.id,'1');
    assert.equal((await left.db.query('SELECT company_id,venue_id FROM spaceverse_crm_contacts')).rows[0].venue_id,'51');
    assert.equal((await right.db.query('SELECT company_id,venue_id FROM spaceverse_crm_contacts')).rows[0].venue_id,'61');
  } finally {await left.db.close();await right.db.close();}
});


test('manual CRM contact failures rollback both ledger and contact before a clean retry',async()=>{
  const {db,runtime}=await fixture('f');
  let failCompletion=true;
  const connect=async()=>({query:async(sql,params)=>{
    if(failCompletion&&String(sql).startsWith('UPDATE spaceverse_crm_contact_create_requests')){
      failCompletion=false;
      throw new Error('synthetic completion failure');
    }
    return db.query(sql,params);
  },release(){}});
  try {
    const create=createSpaceverseManualCrmContactService({runtime,connect});
    await assert.rejects(create(contact(key(7))),{code:'SPACEVERSE_CRM_CONTACT_UNAVAILABLE'});
    assert.equal((await db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contacts')).rows[0].n,0);
    assert.equal((await db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contact_create_requests')).rows[0].n,0);
    const first=await create(contact(key(7)));
    assert.deepEqual(await create(contact(key(7))),first);
    assert.equal((await db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contacts')).rows[0].n,1);
  } finally {await db.close();}
});

test('manual CRM contact uncertain COMMIT is reconciled by exact idempotent replay',async()=>{
  const {db,runtime}=await fixture('a');
  let lostAcknowledgement=true;
  const connect=async()=>({query:async(sql,params)=>{
    const result=await db.query(sql,params);
    if(sql==='COMMIT'&&lostAcknowledgement){
      lostAcknowledgement=false;
      throw new Error('synthetic lost COMMIT acknowledgement');
    }
    return result;
  },release(){}});
  try {
    const create=createSpaceverseManualCrmContactService({runtime,connect});
    await assert.rejects(create(contact(key(8))),{code:'SPACEVERSE_CRM_CONTACT_UNAVAILABLE'});
    assert.equal((await db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contacts')).rows[0].n,1);
    const recovered=await create(contact(key(8)));
    assert.equal(recovered.contact.phone,'+79991112233');
    await assert.rejects(create(contact(key(8),{firstName:'Другой'})),
      {code:'SPACEVERSE_CRM_CONTACT_REPLAY_CONFLICT'});
    assert.equal((await db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contacts')).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contact_create_requests')).rows[0].n,1);
  } finally {await db.close();}
});

test('manual CRM contact refuses a valid runtime connected to a different tenant database',async()=>{
  const left=await fixture('b','50','51'),right=await fixture('c','60','61');
  try {
    const wrong=createSpaceverseManualCrmContactService({runtime:left.runtime,connect:right.connect});
    await assert.rejects(wrong(contact(key(9))),{code:'SPACEVERSE_CRM_CONTACT_SCOPE_REJECTED'});
    assert.equal((await right.db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contacts')).rows[0].n,0);
    assert.equal((await right.db.query('SELECT COUNT(*)::integer AS n FROM spaceverse_crm_contact_create_requests')).rows[0].n,0);
  } finally {await left.db.close();await right.db.close();}
});
