import {afterEach,describe,expect,it,vi} from 'vitest'
import {ApiError,getSession} from '../api'

describe('session probe contract',()=>{
  afterEach(()=>vi.unstubAllGlobals())

  it('maps the successful anonymous session probe to an auth state without an HTTP failure',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({authenticated:false}),{
      status:200,
      headers:{'content-type':'application/json'},
    })))

    await expect(getSession()).rejects.toMatchObject({status:401,code:'AUTH_REQUIRED'} satisfies Partial<ApiError>)
  })
})
