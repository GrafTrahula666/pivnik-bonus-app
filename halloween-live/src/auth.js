import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { LiveError } from './source.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
const dummyHash = passwordHash(randomBytes(32).toString('hex'));
export function checkPassword(password, stored = dummyHash) {
  const [salt, hex] = stored.split(':');
  const expected = Buffer.from(hex || '', 'hex');
  const actual = scryptSync(String(password).slice(0, 256), salt || '', 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function readAccounts(raw) {
  const accounts = JSON.parse(raw || '[]');
  if (!Array.isArray(accounts) || !accounts.length || accounts.length > 20) throw new Error('Configure LIVE_ACCOUNTS_JSON.');
  const seen = new Set();
  for (const a of accounts) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(a.name) || seen.has(a.name) || !['owner', 'operator', 'scanner', 'screen'].includes(a.role)
      || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(a.passwordHash)) throw new Error('Invalid account configuration.');
    seen.add(a.name);
  }
  return accounts;
}
export class Auth {
  constructor(db, accounts) { this.db = db; this.accounts = accounts; }
  async login(account, password, ip) {
    const key = digest(`${ip}:${String(account).slice(0, 40)}`);
    const globalKey = digest(`ip:${ip}`);
    const found = this.accounts.find(a => a.name === account);
    // Reserve an attempt before the expensive hash; shared across processes.
    await this.db.exclusive(async c => {
      for (const k of [key, globalKey]) {
        const { rows } = await c.query(`INSERT INTO halloween_live.login_attempts(key,attempts,until_at)
          VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET
          attempts=CASE WHEN halloween_live.login_attempts.until_at<now() THEN 1 ELSE halloween_live.login_attempts.attempts+1 END,
          until_at=CASE WHEN halloween_live.login_attempts.until_at<now() THEN now()+interval '10 minutes' ELSE halloween_live.login_attempts.until_at END RETURNING attempts`, [k]);
        if (rows[0].attempts > (k === key ? 10 : 50)) throw new LiveError('login_rate_limited', 429);
      }
    });
    if (!checkPassword(password, found?.passwordHash) || !found) throw new LiveError('invalid_login', 401);
    return this.createSession(found);
  }
  async openDemoScanner() {
    if (!this.db.demo) throw new LiveError('forbidden', 403);
    return this.scannerSession();
  }
  async openScannerLink(token, expected) {
    if (typeof token !== 'string' || typeof expected !== 'string' || expected.length < 32
      || !timingSafeEqual(Buffer.from(digest(token)), Buffer.from(digest(expected)))) throw new LiveError('invalid_scanner_link', 401);
    return this.scannerSession();
  }
  async scannerSession() {
    const account = this.accounts.find(a => a.role === 'scanner');
    if (!account) throw new LiveError('service_unavailable', 503);
    return this.createSession(account);
  }
  async createSession(found) {
    const token = randomBytes(32).toString('hex');
    await this.db.exclusive(c => c.query(`INSERT INTO halloween_live.sessions(hash,account,role,credential_version,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '12 hours')`, [digest(token), found.name, found.role, digest(found.passwordHash)]));
    return { token, account: found.name, role: found.role };
  }
  async session(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const { rows } = await this.db.exclusive(c => c.query('SELECT * FROM halloween_live.sessions WHERE hash=$1 AND expires_at>now()', [digest(token)]));
    const r = rows[0];
    const account = this.accounts.find(a => a.name === r?.account);
    return account && r.role === account.role && r.credential_version === digest(account.passwordHash) ? { account: r.account, role: r.role } : null;
  }
  async logout(token) { await this.db.exclusive(c => c.query('DELETE FROM halloween_live.sessions WHERE hash=$1', [digest(token || '')])); }
}
