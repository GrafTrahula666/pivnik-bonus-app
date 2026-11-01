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
    vi.stubGlobal('crypto',{randomUUID:()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`})
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
    host=document.createElement('div');document.body.appendChild(host)
    root=createRoot(host)
    act(()=>root.render(<TenantCrmContactCreate actorId="11" draftId="123e4567-e89b-42d3-a456-426614174000"/>))
  })
  afterEach(()=>{
    act(()=>root.unmount());host.remove();vi.unstubAllGlobals()
  })
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
  it('rejects a malformed successful response and keeps the replay key',async()=>{
    post.mockResolvedValueOnce({schemaVersion:1,contact:{id:'93'}} as never)
    await fill();await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Подтверждение не получено')
    expect(host.textContent).toContain('Повторить с тем же ключом')
    expect(host.textContent).not.toContain('Контакт №93 создан')
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
