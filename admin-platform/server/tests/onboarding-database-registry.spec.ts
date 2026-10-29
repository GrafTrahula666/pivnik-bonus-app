// @vitest-environment node
import type { PoolConfig } from 'pg'
import { describe,expect,it } from 'vitest'
import { createOnboardingTargetRegistry } from '../onboarding-database-registry.js'

const runtimeA='sv-'+'a'.repeat(32)
const runtimeB='sv-'+'b'.repeat(32)
const referenceA='SPACEVERSE_TENANT_DATABASE_URL_A'

function fakeFactory(calls:PoolConfig[],closed:string[]) {
  return (config:PoolConfig)=>{
    calls.push(config)
    const marker=String(config.connectionString)
    const target={
      connect:async()=>{throw new Error('Synthetic target is not queried by this unit test')},
      end:async()=>{closed.push(marker)},
      on:()=>target,
    }
    return target as never
  }
}

describe('protected onboarding database registry',()=>{
  it('resolves only a referenced secret env, caches it, rotates on change and closes pools',async()=>{
    const calls:PoolConfig[]=[],closed:string[]=[]
    const env:NodeJS.ProcessEnv={
      ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON:JSON.stringify({[runtimeA]:{credentialEnv:referenceA}}),
      [referenceA]:'postgresql://tenant:synthetic-one@tenant-a.internal:5432/spaceverse_a',
    }
    const registry=createOnboardingTargetRegistry({env,poolFactory:fakeFactory(calls,closed)})
    expect(registry.validate()).toEqual({registered:1})
    const [first,concurrent]=await Promise.all([
      registry.resolveTargetDatabase(runtimeA),registry.resolveTargetDatabase(runtimeA),
    ])
    expect(first).toBeTruthy()
    expect(concurrent).toBe(first)
    expect(await registry.resolveTargetDatabase(runtimeA)).toBe(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({max:2,application_name:'spaceverse-onboarding-provisioner'})
    expect(calls[0].ssl).toEqual({rejectUnauthorized:true})

    env[referenceA]='postgresql://tenant:synthetic-two@tenant-b.internal:5432/spaceverse_b'
    const rotated=await registry.resolveTargetDatabase(runtimeA)
    expect(rotated).not.toBe(first)
    expect(calls).toHaveLength(2)
    expect(closed).toEqual(['postgresql://tenant:synthetic-one@tenant-a.internal:5432/spaceverse_a'])

    delete env[referenceA]
    expect(await registry.resolveTargetDatabase(runtimeA)).toBeNull()
    expect(closed).toHaveLength(2)
    await registry.close()
  })

  it('keeps a missing or unknown credential unregistered without inventing a target',async()=>{
    const registry=createOnboardingTargetRegistry({env:{
      ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON:JSON.stringify({[runtimeA]:{credentialEnv:referenceA}}),
    },poolFactory:fakeFactory([],[])})
    expect(registry.validate()).toEqual({registered:1})
    expect(await registry.resolveTargetDatabase(runtimeA)).toBeNull()
    expect(await registry.resolveTargetDatabase(runtimeB)).toBeNull()
    expect(await registry.resolveTargetDatabase('not-a-runtime-key')).toBeNull()
  })

  it('rejects embedded URLs, duplicate references and malformed runtime keys with a fixed safe error',()=>{
    const badRegistries=[
      {[runtimeA]:{databaseUrl:'postgresql://tenant:must-not-appear@host/db'}},
      {[runtimeA]:{credentialEnv:referenceA},[runtimeB]:{credentialEnv:referenceA}},
      {'pivnik':{credentialEnv:referenceA}},
      {[runtimeA]:{credentialEnv:'DATABASE_URL'}},
    ]
    for(const value of badRegistries) {
      let error:unknown
      try {createOnboardingTargetRegistry({env:{ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON:JSON.stringify(value)}})}
      catch(candidate) {error=candidate}
      expect(error).toMatchObject({code:'ONBOARDING_DATABASE_REGISTRY_INVALID',statusCode:500})
      expect(JSON.stringify(error)).not.toContain('must-not-appear')
    }
  })

  it('refuses the Admin or historical application database even with another user and query',()=>{
    const secret='shared-password-must-not-leak'
    const registry=createOnboardingTargetRegistry({env:{
      ADMIN_DATABASE_URL:'postgresql://admin:metadata@shared.internal:5432/shared_db?sslmode=require',
      DATABASE_URL:'postgresql://pivnik:legacy@legacy.internal:5432/pivnik',
      ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON:JSON.stringify({[runtimeA]:{credentialEnv:referenceA}}),
      [referenceA]:`postgresql://tenant:${secret}@shared.internal/shared_db?application_name=tenant`,
    }})
    let error:unknown
    try {registry.validate()} catch(candidate) {error=candidate}
    expect(error).toMatchObject({code:'ONBOARDING_DATABASE_REGISTRY_INVALID',statusCode:500})
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it('refuses two runtime keys that resolve to the same dedicated database',()=>{
    const referenceB='SPACEVERSE_TENANT_DATABASE_URL_B',secret='duplicate-target-must-not-leak'
    const registry=createOnboardingTargetRegistry({env:{
      ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON:JSON.stringify({
        [runtimeA]:{credentialEnv:referenceA},[runtimeB]:{credentialEnv:referenceB},
      }),
      [referenceA]:`postgresql://tenant_a:${secret}@tenant.internal:5432/shared_tenant`,
      [referenceB]:'postgresql://tenant_b:other@tenant.internal/shared_tenant?sslmode=require',
    }})
    let error:unknown
    try {registry.validate()} catch(candidate) {error=candidate}
    expect(error).toMatchObject({code:'ONBOARDING_DATABASE_REGISTRY_INVALID',statusCode:500})
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it('retains verified TLS after a URL requests libpq require semantics',async()=>{
    const calls:PoolConfig[]=[]
    const registry=createOnboardingTargetRegistry({env:{
      ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON:JSON.stringify({[runtimeA]:{credentialEnv:referenceA}}),
      [referenceA]:'postgresql://tenant:synthetic@tenant.example/spaceverse?sslmode=require&uselibpqcompat=true',
    },poolFactory:fakeFactory(calls,[])})
    await registry.resolveTargetDatabase(runtimeA)
    expect(calls[0].ssl).toEqual({rejectUnauthorized:true})
    expect(calls[0].connectionString).not.toContain('sslmode')
    expect(calls[0].connectionString).not.toContain('uselibpqcompat')
    await registry.close()
  })

  it.each(['sslmode=disable','sslmode=no-verify','host=another.example'])(
    'refuses an unsafe tenant transport before creating a pool: %s',async query=>{
      const calls:PoolConfig[]=[]
      const registry=createOnboardingTargetRegistry({env:{
        ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON:JSON.stringify({[runtimeA]:{credentialEnv:referenceA}}),
        [referenceA]:`postgresql://tenant:must-not-leak@tenant.example/spaceverse?${query}`,
      },poolFactory:fakeFactory(calls,[])})
      expect(()=>registry.validate()).toThrowError(expect.objectContaining({code:'ONBOARDING_DATABASE_REGISTRY_INVALID'}))
      await expect(registry.resolveTargetDatabase(runtimeA)).rejects.toMatchObject({code:'ONBOARDING_DATABASE_REGISTRY_INVALID'})
      expect(calls).toHaveLength(0)
    })
})
