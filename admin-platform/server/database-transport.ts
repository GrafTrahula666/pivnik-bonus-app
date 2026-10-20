import type { PoolConfig } from 'pg'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import { HttpError } from './types.js'

const invalid=()=>new HttpError(500,'ADMIN_DATABASE_TRANSPORT_INVALID',
  'Небезопасные параметры подключения к базе. Проверьте адрес и доверенный сертификат сервера.')
const tlsParameters=new Set(['ssl','sslmode','uselibpqcompat','sslnegotiation'])
const forbiddenParameters=new Set(['host','hostaddr','port','user','password','database','sslcert','sslkey','sslrootcert'])
const strictModes=new Set(['prefer','require','verify-ca','verify-full'])

/** pg reparses connectionString after applying ssl. Remove URL TLS overrides
 * so the final driver configuration keeps certificate AND hostname validation.
 * Custom CAs belong in Node's protected NODE_EXTRA_CA_CERTS trust configuration,
 * never in URL-controlled file paths. No credentials are included in errors.
 */
export function databaseConnectionOptions(raw:string):Pick<PoolConfig,'connectionString'|'ssl'>&{sslnegotiation?:'postgres'|'direct'} {
  // An empty optional URL has no target. Runtime config validates required URLs.
  if(!raw)return {connectionString:'',ssl:false}
  try {
    const url=new URL(raw)
    if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.hostname.includes('%')||url.hash||
      !url.pathname||url.pathname==='/')throw invalid()
    const host=url.hostname.toLowerCase()
    // Inspect only the parsed host: a password, database name or suffix cannot
    // turn a public connection into a trusted local/private transport.
    const privateHost=host==='localhost'||host==='127.0.0.1'||host.endsWith('.railway.internal')
    let tls=!privateHost
    let negotiation:'postgres'|'direct'='postgres'
    const seen=new Set<string>()
    for(const [key,value] of url.searchParams) {
      const name=key.toLowerCase()
      if(forbiddenParameters.has(name))throw invalid()
      if(!tlsParameters.has(name))continue
      if(key!==name||seen.has(name))throw invalid()
      seen.add(name)
      if(name==='sslmode') {
        if(strictModes.has(value))tls=true
        else if(value!=='disable'||!privateHost)throw invalid()
      }else if(name==='ssl') {
        if(value==='true'||value==='1')tls=true
        else if(!['false','0'].includes(value)||!privateHost)throw invalid()
      }else if(name==='sslnegotiation') {
        if(!['postgres','direct'].includes(value))throw invalid()
        negotiation=value as 'postgres'|'direct'
        if(value==='direct')tls=true
      }else if(!['true','false'].includes(value))throw invalid()
    }
    // Ambiguous flags are an operator error, not permission to downgrade TLS.
    if((url.searchParams.get('sslmode')==='disable'&&tls)||
      (['false','0'].includes(url.searchParams.get('ssl')??'')&&tls))throw invalid()
    for(const key of [...url.searchParams.keys()]) {
      if(tlsParameters.has(key.toLowerCase()))url.searchParams.delete(key)
    }
    return {connectionString:url.href,sslnegotiation:negotiation,ssl:tls?{
      rejectUnauthorized:true,
      // pg omits SNI for IP literals. Bind identity checking to the actual IP
      // rather than allowing Node's default TLS hostname (localhost).
      ...(isIP(host)?{checkServerIdentity:(_name,certificate)=>checkServerIdentity(host,certificate)}:{}),
    }:false}
  }catch {throw invalid()}
}
