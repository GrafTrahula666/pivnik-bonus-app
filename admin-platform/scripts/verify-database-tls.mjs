// Local TLS boundary proof, not a production DB or a PostgreSQL SQL test.
// Requires npm run build:api, OpenSSL, and loopback sockets. Generated keys are
// synthetic and retained only in a unique 0700 temporary fixture directory.
import assert from 'node:assert/strict'
import { execFileSync,spawn } from 'node:child_process'
import { mkdtempSync,readFileSync,writeFileSync,chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import tls from 'node:tls'
import pg from 'pg'
import { databaseConnectionOptions } from '../dist-server/database-transport.js'

const marker='SYNTHETIC_TLS_BOUNDARY_REACHED'
if(process.argv[2]==='--client') {
  const [url,expected]=process.argv.slice(3)
  const client=new pg.Client({...databaseConnectionOptions(url),connectionTimeoutMillis:3000})
  try {
    let failure
    try {await client.connect()}catch(error){failure=error}
    assert.ok(failure,'A TLS protocol fixture must never authenticate a real PostgreSQL session')
    if(expected==='trusted') {
      assert.equal(failure.code,'XX000')
      assert.equal(failure.message,marker)
    }else if(expected==='wrong-host')assert.equal(failure.code,'ERR_TLS_CERT_ALTNAME_INVALID')
    else assert.ok(['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(failure.code),
      `Expected a certificate trust failure, got ${failure.code}`)
  }finally {await client.end().catch(()=>undefined)}
}else {
  const folder=mkdtempSync(path.join(tmpdir(),'spaceverse-synthetic-tls-'))
  chmodSync(folder,0o700)
  const file=name=>path.join(folder,name)
  const openssl=(...args)=>execFileSync('openssl',args,{cwd:folder,stdio:'ignore'})
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout','ca.key','-out','ca.crt',
    '-subj','/CN=SPACEVERSE synthetic local test CA','-addext','basicConstraints=critical,CA:TRUE')
  for(const [name,san] of [['correct','IP:127.0.0.1'],['wrong','DNS:localhost']]) {
    openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout',`${name}.key`,'-out',`${name}.csr`,
      '-subj',`/CN=SPACEVERSE synthetic ${name}`)
    writeFileSync(file(`${name}.ext`),`subjectAltName=${san}\nextendedKeyUsage=serverAuth\n`,{mode:0o600})
    openssl('x509','-req','-in',`${name}.csr`,'-CA','ca.crt','-CAkey','ca.key','-set_serial',name==='correct'?'2':'3',
      '-days','1','-out',`${name}.crt`,'-extfile',`${name}.ext`)
    chmodSync(file(`${name}.key`),0o600)
  }
  chmodSync(file('ca.key'),0o600)

  async function probe(name,trust,expected,query='sslmode=require&uselibpqcompat=true') {
    let startupCount=0
    const sockets=new Set()
    const track=socket=>{
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>undefined)
    }
    const startup=secure=>{
      track(secure)
      secure.once('data',()=>{
        startupCount++
        // The startup message is reached only after client-side trust/identity
        // validation. Stop here: no database, password, SQL or money operation.
        const payload=Buffer.from(`SFATAL\0CXX000\0M${marker}\0\0`)
        const header=Buffer.alloc(5);header.write('E');header.writeInt32BE(payload.length+4,1)
        secure.end(Buffer.concat([header,payload]))
      })
    }
    const options={key:readFileSync(file(`${name}.key`)),cert:readFileSync(file(`${name}.crt`))}
    const direct=new URLSearchParams(query).get('sslnegotiation')==='direct'
    const context=tls.createSecureContext(options)
    const server=direct?tls.createServer({...options,ALPNProtocols:['postgresql']},startup):net.createServer(socket=>{
      track(socket)
      socket.once('data',request=>{
        assert.equal(request.toString('hex'),'0000000804d2162f','Expected a real PostgreSQL SSLRequest')
        socket.write('S')
        startup(new tls.TLSSocket(socket,{isServer:true,secureContext:context}))
      })
    })
    if(direct){server.on('connection',track);server.on('tlsClientError',()=>undefined)}
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    try {
      const url=`postgresql://crm_fixture:synthetic_local_only@127.0.0.1:${server.address().port}/synthetic_tls?${query}`
      // Spawn asynchronously: the parent must keep serving the TLS handshake.
      const child=spawn(process.execPath,[process.argv[1],'--client',url,expected],{
        env:{...process.env,NODE_EXTRA_CA_CERTS:trust?file('ca.crt'):''},stdio:['ignore','pipe','pipe'],
      })
      let output='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data})
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)})
      assert.equal(code,0,output)
      assert.equal(startupCount,expected==='trusted'?1:0)
      console.log(`${direct?'direct':'SSLRequest'} ${expected}: PASS; PostgreSQL startup messages=${startupCount}`)
    }finally {
      for(const socket of sockets)socket.destroy()
      await new Promise(resolve=>server.close(resolve))
    }
  }
  await probe('correct',true,'trusted')
  await probe('correct',false,'untrusted')
  await probe('wrong',true,'wrong-host')
  // A valid chain is still insufficient when ssl=true is supplied in the URL.
  await probe('wrong',true,'wrong-host','ssl=true')
  await probe('correct',true,'trusted','sslnegotiation=direct')
  await probe('wrong',true,'wrong-host','sslnegotiation=direct')
  console.log(`TLS boundary: 6 passed. Synthetic certificate fixtures: ${folder}`)
}
