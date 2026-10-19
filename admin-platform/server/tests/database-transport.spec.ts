// @vitest-environment node
import pg from 'pg'
import type { PeerCertificate } from 'node:tls'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { databaseConnectionOptions } from '../database-transport.js'

afterEach(()=>vi.unstubAllEnvs())

// Inspect the actual installed pg parser, which can overwrite an explicit ssl
// option from URL parameters. No network connection is opened by a constructor.
function effective(raw:string) {
  const client=new pg.Client(databaseConnectionOptions(raw))
  return client as unknown as {ssl:false|{rejectUnauthorized:boolean;checkServerIdentity?:unknown};host:string;password:string;database:string}
}

describe('PostgreSQL transport boundary',()=>{
  it.each([
    'public.example','localhost.public.example','127.0.0.1.public.example',
    'public.railway.internal.example','railway.internal','public.example.',
  ])('requires validated TLS for external hostname %s',host=>{
    expect(effective(`postgresql://admin:localhost@${host}/railway.internal`).ssl)
      .toEqual({rejectUnauthorized:true})
  })

  it.each(['localhost','127.0.0.1','postgres.railway.internal','POSTGRES.RAILWAY.INTERNAL'])(
    'retains the existing private/local transport for exact hostname %s',host=>{
      expect(effective(`postgresql://admin:synthetic@${host}/metadata`).ssl).toBe(false)
    })

  it.each(['require','verify-ca','verify-full','prefer'])(
    'keeps hostname and certificate validation after pg parses sslmode=%s',mode=>{
      const options=databaseConnectionOptions(`postgresql://admin:synthetic@public.example/metadata?sslmode=${mode}&uselibpqcompat=true`)
      expect(options.connectionString).not.toContain('sslmode')
      expect(options.connectionString).not.toContain('uselibpqcompat')
      expect(new pg.Client(options).ssl).toEqual({rejectUnauthorized:true})
    })

  it.each([
    'sslmode=disable','sslmode=no-verify','sslmode=allow','ssl=0','ssl=false','ssl=no-verify',
    'sslmode=disable&sslmode=verify-full','sslmode=require&sslmode=disable',
    'sslmode=verify-full&SSLMODE=disable','sslmode=unknown','sslnegotiation=unknown',
    'sslrootcert=%2Fnot-a-trusted-file','sslcert=%2Fnot-a-certificate','sslkey=%2Fnot-a-key',
    'host=localhost','%68ost=public.example','hostaddr=127.0.0.1','port=5433',
    'user=another','password=another','database=another',
  ])('refuses a URL override without leaking credentials: %s',query=>{
    const raw=`postgresql://admin:must-not-appear@public.example/metadata?${query}`
    try {databaseConnectionOptions(raw);expect.fail('Unsafe URL accepted')}
    catch(error) {
      expect(error).toMatchObject({code:'ADMIN_DATABASE_TRANSPORT_INVALID',statusCode:500})
      expect(String(error)).not.toContain('must-not-appear')
      expect(JSON.stringify(error)).not.toContain('postgresql://')
    }
  })

  it('does not let pg environment variables disable TLS or change the selected host',()=>{
    vi.stubEnv('PGSSLMODE','no-verify')
    vi.stubEnv('PGHOST','localhost')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED','0')
    const client=effective('postgresql://admin:synthetic@public.example/metadata')
    expect(client.ssl).toEqual({rejectUnauthorized:true})
    expect(client.host).toBe('public.example')
  })

  it('preserves escaped credentials and unrelated supported URL parameters',()=>{
    const raw='postgresql://admin:a%40b%3A%2F%3F%26%23@public.example/metadata?application_name=release-review&sslmode=require'
    const options=databaseConnectionOptions(raw),client=effective(raw)
    expect(client.password).toBe('a@b:/?&#')
    expect(client.database).toBe('metadata')
    expect(new URL(options.connectionString!).searchParams.get('application_name')).toBe('release-review')
    expect(client.ssl).toEqual({rejectUnauthorized:true})
  })

  it('honours explicit strict TLS even for a private host, without contradictory flags',()=>{
    expect(effective('postgresql://admin:synthetic@localhost/metadata?sslmode=require').ssl)
      .toEqual({rejectUnauthorized:true})
    expect(effective('postgresql://admin:synthetic@localhost/metadata?sslmode=disable').ssl).toBe(false)
    expect(()=>effective('postgresql://admin:synthetic@localhost/metadata?ssl=false&sslmode=require'))
      .toThrowError(expect.objectContaining({code:'ADMIN_DATABASE_TRANSPORT_INVALID'}))
  })

  it('binds IP identity validation to the selected IP, not a localhost certificate',()=>{
    const ssl=databaseConnectionOptions('postgresql://admin:synthetic@127.0.0.1/metadata?sslmode=require').ssl
    expect(typeof ssl).toBe('object')
    if(!ssl||typeof ssl!=='object')throw new Error('TLS expected')
    expect(ssl.checkServerIdentity?.('localhost',{subjectaltname:'DNS:localhost'} as PeerCertificate))
      .toMatchObject({code:'ERR_TLS_CERT_ALTNAME_INVALID'})
    expect(ssl.checkServerIdentity?.('localhost',{subjectaltname:'IP Address:127.0.0.1'} as PeerCertificate)).toBeUndefined()
  })

  it('preserves strict TLS for direct negotiation without URL or environment overrides',()=>{
    vi.stubEnv('PGSSLNEGOTIATION','direct')
    const raw='postgresql://admin:synthetic@public.example/metadata?sslnegotiation=direct'
    const options=databaseConnectionOptions(raw)
    expect(options.sslnegotiation).toBe('direct')
    expect(options.connectionString).not.toContain('sslnegotiation')
    expect(new pg.Client(options).ssl).toEqual({rejectUnauthorized:true})
    expect(databaseConnectionOptions('postgresql://admin:synthetic@localhost/metadata').sslnegotiation).toBe('postgres')
  })

  it.each(['not-a-url','https://public.example/metadata','postgresql://admin:synthetic@public.example/',
    'postgresql://admin:synthetic@%31%32%37.0.0.1/metadata',
    'postgresql://admin:synthetic@%2Ftmp/metadata',
    'postgresql://admin:synthetic@public.example/metadata#localhost'])(
    'fails closed on an invalid target: %s',raw=>{
      expect(()=>databaseConnectionOptions(raw))
        .toThrowError(expect.objectContaining({code:'ADMIN_DATABASE_TRANSPORT_INVALID'}))
    })

  it('keeps an absent optional URL unconfigured',()=>{
    expect(databaseConnectionOptions('')).toEqual({connectionString:'',ssl:false})
  })
})
