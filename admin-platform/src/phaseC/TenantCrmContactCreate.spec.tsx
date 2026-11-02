// @vitest-environment jsdom
// No new test dependency: React 19 act + react-dom/client + built-in JSDOM.
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {ApiError,apiPost} from '../api'
import {TenantCrmContactCreate} from './TenantCrmContactCreate'

vi.mock('../api',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('../api')>()
  return {...actual,apiPost:vi.fn()}
})
const post=vi.mocked(apiPost)
const confirmed=(raw:unknown)=>{
  const data=raw as {requestKey:string;contact:{firstName:string;lastName:string|null;email:string|null;phone:string|null}}
  return {schemaVersion:1,requestKey:data.requestKey,
    contact:{id:'93',...data.contact,identityStatus:'unlinked',walletStatus:'not_created'},
    identityStatus:'unlinked',walletStatus:'not_created'}
}
describe('CHAT03 #24: manual CRM owner contact form',()=>{
  let host:HTMLDivElement,root:Root,sequence=0
  beforeEach(()=>{
    post.mockReset();sequence=0
    localStorage.clear()
    vi.stubGlobal('crypto',{
      randomUUID:()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`,
      subtle:{digest:async(_algorithm:string,input:ArrayBuffer)=>{
        // Stable 32-byte test fingerprint. Chromium E2E tests WebCrypto SHA-256.
        const bytes=new Uint8Array(input),hash=new Uint8Array(32)
        for(let i=0;i<bytes.length;i++)hash[i%32]=(hash[i%32]!+bytes[i]!+i)%256
        return hash.buffer
      }},
    })
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
    host=document.createElement('div');document.body.appendChild(host)
    root=createRoot(host)
    act(()=>root.render(<TenantCrmContactCreate actorId="11" draftId="123e4567-e89b-42d3-a456-426614174000"/>))
  })
  afterEach(()=>{
    act(()=>root.unmount());host.remove();vi.unstubAllGlobals()
  })
  const remount=()=>{
    act(()=>root.unmount())
    host.replaceChildren()
    root=createRoot(host)
    act(()=>root.render(<TenantCrmContactCreate actorId="11" draftId="123e4567-e89b-42d3-a456-426614174000"/>))
  }
  const findInput=(label:string)=>{
    const field=[...host.querySelectorAll('label')].find(el=>el.textContent?.trim()===label)
    const input=field?.querySelector('input')
    if(!input)throw new Error('Input unavailable: '+label)
    return input
  }
  const set=async(label:string,value:string)=>{
    const input=findInput(label)
    await act(async()=>{
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
      if(!setter)throw new Error('Native input setter unavailable')
      setter.call(input,value)
      input.dispatchEvent(new Event('input',{bubbles:true}))
      input.dispatchEvent(new Event('change',{bubbles:true}))
    })
  }
  const fill=async()=>{
    await set('Имя *','Мария')
    await set('Email','Maria@Example.org')
  }
  const submit=async()=>{
    await act(async()=>{
      host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
    })
  }
  const click=async(text:string)=>{
    const button=[...host.querySelectorAll('button')].find(el=>el.textContent?.includes(text))
    if(!button)throw new Error('Button unavailable: '+text)
    await act(async()=>{button.click()})
  }

  it('rejects missing phone/email before any request',async()=>{
    await set('Имя *','Мария')
    await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('хотя бы один контакт')
    expect(post).not.toHaveBeenCalled()
    expect(findInput('Имя *').disabled).toBe(false)
  })
  it('sends strict contact fields; success confirms no app identity or wallet',async()=>{
    post.mockImplementation(async (_path,body)=>confirmed(body) as never)
    await fill();await submit()
    expect(host.textContent).toContain('Контакт №93 создан')
    expect(host.textContent).toContain('кошелёк не создан')
    expect(post).toHaveBeenCalledTimes(1)
    const [url,raw]=post.mock.calls[0]!
    const data=raw as {requestKey:string;contact:{firstName:string;email:string}}
    expect(url).toBe('/api/admin/onboarding/drafts/123e4567-e89b-42d3-a456-426614174000/crm/contacts')
    expect(data.requestKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(data.contact).toMatchObject({firstName:'Мария',email:'maria@example.org'})
    expect(Object.keys(data)).toEqual(['requestKey','contact'])
    expect(findInput('Имя *').value).toBe('')
  })
  it('does not send a second POST while the first creation is in flight',async()=>{
    let finish!:()=>void
    post.mockImplementationOnce(async(_path,body)=>new Promise<never>(resolve=>{
      finish=()=>resolve(confirmed(body) as never)
    }))
    await fill()
    await act(async()=>{
      const form=host.querySelector('form')!
      // A rapid double-submit must not generate another UUID or POST while
      // the first request has not yet received an acknowledgement.
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
    })
    expect(post).toHaveBeenCalledTimes(1)
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    await act(async()=>{finish()})
    expect(host.textContent).toContain('Контакт №93 создан')
    expect(localStorage.length).toBe(0)
  })
  it('fails closed when a successful POST cannot clear its pending checkpoint',async()=>{
    post.mockImplementationOnce(async(_path,body)=>confirmed(body) as never)
    const remove=vi.spyOn(Storage.prototype,'removeItem')
      .mockImplementationOnce(()=>{throw new Error('simulated storage write failure')})
    try{
      await fill();await submit()
      expect(post).toHaveBeenCalledTimes(1)
      expect(host.textContent).not.toContain('Контакт №93 создан')
      expect(host.querySelector('fieldset')?.disabled).toBe(true)
      expect(host.textContent).toContain('Нельзя безопасно восстановить')
      expect(localStorage.length).toBe(1)
      // Never issue another POST after the local checkpoint becomes uncertain.
      await submit()
      expect(post).toHaveBeenCalledTimes(1)
    }finally{remove.mockRestore()}
  })
  it('retains request key and disabled inputs after uncertain 503, then replays',async()=>{
    post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
      .mockImplementationOnce(async(_path,body)=>confirmed(body) as never)
    await fill();await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('повторите с тем же ключом')
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    await click('Повторить с тем же ключом')
    expect(host.textContent).toContain('Контакт №93 создан')
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1])
  })
  it('retains the original request key if a recovery retry is rate limited',async()=>{
    post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
      .mockRejectedValueOnce(new ApiError(429,'RATE_LIMITED','throttled'))
      .mockImplementationOnce(async(_path,body)=>confirmed(body) as never)
    await fill();await submit()
    await click('Повторить с тем же ключом')
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    expect(host.textContent).toContain('Повторить с тем же ключом')
    await click('Повторить с тем же ключом')
    expect(host.textContent).toContain('Контакт №93 создан')
    expect(post).toHaveBeenCalledTimes(3)
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1])
    expect(post.mock.calls[1]![1]).toEqual(post.mock.calls[2]![1])
  })
  it.each([401,403] as const)(
    'preserves an uncertain request after an authorization denial on replay (%i)',async(status)=>{
      post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
        .mockRejectedValueOnce(new ApiError(status,
          status===401?'SESSION_EXPIRED':'TENANT_CRM_CONTACT_SCOPE_DENIED','denied'))
      await fill();await submit()
      const original=(post.mock.calls[0]![1] as {requestKey:string}).requestKey
      await click('Повторить с тем же ключом')
      expect(post).toHaveBeenCalledTimes(2)
      expect((post.mock.calls[1]![1] as {requestKey:string}).requestKey).toBe(original)
      expect(host.querySelector('fieldset')?.disabled).toBe(true)
      expect(host.textContent).toContain('Повторить с тем же ключом')
      expect(host.textContent).not.toContain('Контакт №93 создан')
      expect(localStorage.length).toBe(1)
      remount()
      expect(host.textContent).toContain('Есть незавершённый запрос')
      expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).requestKey).toBe(original)
      expect(post).toHaveBeenCalledTimes(2)
    },
  )
  it('rejects a malformed successful response and keeps the replay key',async()=>{
    post.mockResolvedValueOnce({schemaVersion:1,contact:{id:'93'}} as never)
    await fill();await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Подтверждение не получено')
    expect(host.textContent).toContain('Повторить с тем же ключом')
    expect(host.textContent).not.toContain('Контакт №93 создан')
  })
  it('rejects a 200 response carrying a different request key',async()=>{
    post.mockImplementationOnce(async(_path,body)=>({
      ...confirmed(body),requestKey:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }) as never)
    await fill();await submit()
    expect(post).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('Контакт №93 создан')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Подтверждение не получено')
    expect(host.textContent).toContain('Повторить с тем же ключом')
    expect(localStorage.length).toBe(1)
    expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).requestKey)
      .toBe((post.mock.calls[0]![1] as {requestKey:string}).requestKey)
  })
  it('rejects a 200 response with another contact under the same request key',async()=>{
    post.mockImplementationOnce(async(_path,body)=>({
      ...confirmed(body),
      contact:{...confirmed(body).contact,email:'other@example.org'},
    }) as never)
    await fill();await submit()
    expect(post).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('Контакт №93 создан')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Подтверждение не получено')
    expect(host.textContent).toContain('Повторить с тем же ключом')
    expect(localStorage.length).toBe(1)
    expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).requestKey)
      .toBe((post.mock.calls[0]![1] as {requestKey:string}).requestKey)
  })
  it.each(['identity','wallet'] as const)(
    'rejects a 200 response falsely claiming %s linkage for a manual contact',async(claim)=>{
      post.mockImplementationOnce(async(_path,body)=>{
        const result=confirmed(body)
        return (claim==='identity'
          ? {...result,contact:{...result.contact,identityStatus:'linked'}}
          : {...result,walletStatus:'created'}) as never
      })
      await fill();await submit()
      expect(post).toHaveBeenCalledTimes(1)
      expect(host.textContent).not.toContain('Контакт №93 создан')
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('Подтверждение не получено')
      expect(host.textContent).toContain('Повторить с тем же ключом')
      expect(localStorage.length).toBe(1)
      expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).requestKey)
        .toBe((post.mock.calls[0]![1] as {requestKey:string}).requestKey)
    },
  )
  it('reloads with only UUID/salted digest, rejects modified inputs and replays the original request',async()=>{
    post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
      .mockImplementationOnce(async(_path,body)=>confirmed(body) as never)
    await fill();await submit()
    const raw=Object.values(localStorage).join(' ')
    expect(JSON.stringify({...localStorage})).not.toContain('maria@example.org')
    expect(JSON.stringify({...localStorage})).not.toContain('Мария')
    expect(host.textContent).toContain('Повторить с тем же ключом')
    const first=post.mock.calls[0]![1] as {requestKey:string}
    remount()
    expect(host.textContent).toContain('Есть незавершённый запрос')
    expect(findInput('Имя *').disabled).toBe(false)
    expect(host.textContent).toContain('Восстановить исходный запрос')
    await set('Имя *','Мария')
    await set('Email','not-the-same@example.org')
    await click('Восстановить исходный запрос')
    expect(host.textContent).toContain('Данные отличаются')
    expect(post).toHaveBeenCalledTimes(1)
    await set('Email','Maria@Example.org')
    await click('Восстановить исходный запрос')
    expect(post).toHaveBeenCalledTimes(2)
    expect((post.mock.calls[1]![1] as {requestKey:string}).requestKey).toBe(first.requestKey)
    expect(host.textContent).toContain('Контакт №93 создан')
    expect(localStorage.length).toBe(0)
    void raw
  })
  it('fails closed if the pending storage record is corrupted after reload',async()=>{
    post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
    await fill();await submit()
    const key=localStorage.key(0)!
    localStorage.setItem(key,'{"version":1,"requestKey":"bad"}')
    remount()
    expect(host.textContent).toContain('Нельзя безопасно восстановить')
    // Disabled fieldset is authoritative: HTMLInputElement.disabled remains
    // false for an input disabled by its ancestor in JSDOM.
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    await click('Создать контакт')
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('blocks a mounted form as soon as another tab creates a pending key',async()=>{
    const key='spaceverse:crm-manual-contact:pending:v1:11:123e4567-e89b-42d3-a456-426614174000'
    const foreign=JSON.stringify({version:1,
      requestKey:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      nonce:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'a'.repeat(64)})
    await act(async()=>{
      // Browsers emit this event in the *other* tab, not the writer tab.
      localStorage.setItem(key,foreign)
      window.dispatchEvent(new StorageEvent('storage',{
        key,oldValue:null,newValue:foreign,storageArea:localStorage,
      }))
    })
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    expect(host.textContent).toContain('Нельзя безопасно восстановить')
    await submit()
    expect(post).not.toHaveBeenCalled()
    expect(localStorage.getItem(key)).toBe(foreign)
  })
  it('blocks a mounted retry immediately after another tab clears localStorage',async()=>{
    post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
    await fill();await submit()
    expect(post).toHaveBeenCalledTimes(1)
    expect(localStorage.length).toBe(1)
    await act(async()=>{
      // A cross-tab Storage.clear() event has null key and values.
      localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage',{
        key:null,oldValue:null,newValue:null,storageArea:localStorage,
      }))
    })
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    expect(host.textContent).toContain('Нельзя безопасно восстановить')
    await submit()
    expect(post).toHaveBeenCalledTimes(1)
    expect(localStorage.length).toBe(0)
  })
  it('pre-mounted second tab cannot overwrite an uncertain contact request key',async()=>{
    // Simulate another tab opened before the first tab persists its request.
    // Both forms initially saw empty storage, but the second must recheck
    // shared storage immediately before issuing its own POST.
    const otherHost=document.createElement('div')
    document.body.appendChild(otherHost)
    const otherRoot=createRoot(otherHost)
    try{
      act(()=>otherRoot.render(<TenantCrmContactCreate actorId="11" draftId="123e4567-e89b-42d3-a456-426614174000"/>))
      post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
      await fill();await submit()
      expect(post).toHaveBeenCalledTimes(1)
      const storageKey=localStorage.key(0)!
      const original=localStorage.getItem(storageKey)
      expect(original).toContain('requestKey')
      const secondSet=async(label:string,value:string)=>{
        const field=[...otherHost.querySelectorAll('label')].find(el=>el.textContent?.trim()===label)
        const input=field?.querySelector('input')
        if(!input)throw new Error('Second form input unavailable: '+label)
        await act(async()=>{
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
          if(!setter)throw new Error('Native input setter unavailable')
          setter.call(input,value)
          input.dispatchEvent(new Event('input',{bubbles:true}))
          input.dispatchEvent(new Event('change',{bubbles:true}))
        })
      }
      await secondSet('Имя *','Другая')
      await secondSet('Email','other@example.org')
      await act(async()=>{
        otherHost.querySelector('form')!.dispatchEvent(
          new Event('submit',{bubbles:true,cancelable:true}))
      })
      expect(post).toHaveBeenCalledTimes(1)
      expect(otherHost.textContent).toContain('Нельзя безопасно восстановить')
      expect(otherHost.querySelector('fieldset')?.disabled).toBe(true)
      expect(localStorage.getItem(storageKey)).toBe(original)
    }finally{
      act(()=>otherRoot.unmount())
      otherHost.remove()
    }
  })
  it('blocks a stale-tab retry when another tab replaced its pending key',async()=>{
    post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
    await fill();await submit()
    expect(post).toHaveBeenCalledTimes(1)
    const key=localStorage.key(0)!
    const previous=JSON.parse(localStorage.getItem(key)!) as Record<string,unknown>
    const newer={...previous,requestKey:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
    localStorage.setItem(key,JSON.stringify(newer))
    await click('Повторить с тем же ключом')
    expect(post).toHaveBeenCalledTimes(1)
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    expect(host.textContent).toContain('Нельзя безопасно восстановить')
    expect(localStorage.getItem(key)).toBe(JSON.stringify(newer))
  })
  it('blocks replay if another tab erased the pending checkpoint after an uncertain write',async()=>{
    post.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_UNAVAILABLE','unknown'))
    await fill();await submit()
    expect(post).toHaveBeenCalledTimes(1)
    const key=localStorage.key(0)!
    expect(localStorage.getItem(key)).not.toBeNull()
    // A different tab or browser cleanup can erase the checkpoint without
    // notifying this mounted form. Never replay using only in-memory state.
    localStorage.removeItem(key)
    await click('Повторить с тем же ключом')
    expect(post).toHaveBeenCalledTimes(1)
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    expect(host.textContent).toContain('Нельзя безопасно восстановить')
    expect(host.textContent).not.toContain('Контакт №93 создан')
    expect(localStorage.length).toBe(0)
  })
  it('does not erase a newer tab checkpoint after a late successful response',async()=>{
    const replacement='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    post.mockImplementationOnce(async(_path,body)=>{
      const key=localStorage.key(0)!
      const previous=JSON.parse(localStorage.getItem(key)!) as Record<string,unknown>
      localStorage.setItem(key,JSON.stringify({...previous,requestKey:replacement}))
      return confirmed(body) as never
    })
    await fill();await submit()
    expect(post).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('Контакт №93 создан')
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    expect(host.textContent).toContain('Нельзя безопасно восстановить')
    expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).requestKey).toBe(replacement)
  })
  it('permits corrected input with a fresh key after a definitive duplicate',async()=>{
    post.mockRejectedValueOnce(new ApiError(409,'TENANT_CRM_CONTACT_DUPLICATE','duplicate'))
      .mockImplementationOnce(async(_path,body)=>confirmed(body) as never)
    await fill();await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('уже используется')
    expect(findInput('Email').disabled).toBe(false)
    await set('Email','new@example.org');await submit()
    expect(host.textContent).toContain('Контакт №93 создан')
    expect(post).toHaveBeenCalledTimes(2)
    const first=post.mock.calls[0]![1] as {requestKey:string}
    const second=post.mock.calls[1]![1] as {requestKey:string}
    expect(first.requestKey).not.toBe(second.requestKey)
  })
})
