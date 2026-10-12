import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { hashPassword } from '../security.js'

export const fixturePassword='Synthetic-Onboarding-Only-2026!'
export async function onboardingFixture() {
  const db=new PGlite()
  await db.exec(`CREATE TABLE bars(id BIGINT PRIMARY KEY,code TEXT,name TEXT,address TEXT);
    INSERT INTO bars VALUES(1,'pivnik','ПИВНИК','Тестовый адрес');`)
  for(const file of ['001_admin_core.sql','002_configuration_foundation.sql','003_phase_c_write_safety.sql','004_onboarding_drafts.sql','005_onboarding_app_config.sql']) {
    await db.exec(await fs.readFile(new URL('../../admin-migrations/'+file,import.meta.url),'utf8'))
  }
  const passwordHash=hashPassword(fixturePassword)
  for(const [id,name,role] of [[1,'root','SUPER_ADMIN'],[2,'other-root','SUPER_ADMIN'],[11,'owner','VENUE_ADMIN'],[12,'trusted','VENUE_ADMIN']] as const) {
    await db.query(`INSERT INTO admin_accounts(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)`,[id,name+'@fixture.invalid',name,role,passwordHash])
  }
  await db.exec(`
    INSERT INTO companies(id,code,name,active) VALUES(10,'north','Север',TRUE),(20,'south','Юг',TRUE),(30,'inactive','Закрыта',FALSE);
    INSERT INTO venues(company_id,code,name) VALUES(10,'north-1','Север 1'),(10,'north-2','Север 2'),(20,'south-1','Юг 1');
    INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(11,10,'owner'),(12,10,'trusted');
    CREATE TABLE wallets(id INT PRIMARY KEY,balance BIGINT);
    CREATE TABLE transactions(id INT PRIMARY KEY,amount BIGINT);
    INSERT INTO wallets VALUES(1,100);
    INSERT INTO transactions VALUES(1,1000);
  `)
  return db
}
