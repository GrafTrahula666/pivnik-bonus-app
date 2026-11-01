// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {ApiError,apiPost} from '../api'
import {TenantCrmContactCreate} from './TenantCrmContactCreate'

vi.mock('../api',async(importOriginal)=>{
  const real=await importOriginal<typeof import('../api')>()
  return {...real,apiPost:vi.fn()}
})
const writer=vi.mocked(apiPost)
const renderForm=()=>render(<TenantCrmContactCreate actorId="11" draftId="123e4567-e89b-42d3-a456-426614174000"/>)
const fill=()=>{
  fireEvent.change(screen.getByRole('textbox',{name:'Имя *'}),{target:{value:'Мария'}})
  fireEvent.change(screen.getByRole('textbox',{name:'Email'}),{target:{value:'  Maria@Example.org '}})
}
const confirmed=(body:unknown)=>{
  const input=body as {requestKey:string;contact:{firstName:string;lastName:string|null;email:string|null;phone:string|null}}
  return {schemaVersion:1,requestKey:input.requestKey,
    contact:{id:'93',...input.contact,identityStatus:'unlinked',walletStatus:'not_created'},
    identityStatus:'unlinked',walletStatus:'not_created'}
}

describe('CHAT03 #24 owner manual contact form',()=>{
  let nextKey=0
  beforeEach(()=>{
    writer.mockReset()
    nextKey=0
    // JSDOM does not guarantee browser crypto.randomUUID.
    vi.stubGlobal('crypto',{randomUUID:()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++nextKey).padStart(12,'0')}`})
  })
  afterEach(()=>{cleanup();vi.unstubAllGlobals()})

  it('does not send invalid contact and keeps fields usable for correction',async()=>{
    renderForm()
    fireEvent.change(screen.getByRole('textbox',{name:'Имя *'}),{target:{value:'Мария'}})
    fireEvent.click(screen.getByRole('button',{name:'Создать контакт'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('хотя бы один контакт')
    expect(writer).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox',{name:'Имя *'})).toBeEnabled()
  })

  it('sends only allowed fields and acknowledges only a confirmed unlinked contact',async()=>{
    writer.mockImplementation(async (_path,body)=>confirmed(body) as never)
    renderForm();fill()
    fireEvent.click(screen.getByRole('button',{name:'Создать контакт'}))
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Контакт №93 создан'))
    expect(screen.getByRole('status')).toHaveTextContent('кошелёк не создан')
    expect(writer).toHaveBeenCalledTimes(1)
    const [path,raw]=writer.mock.calls[0]!
    const body=raw as {requestKey:string;contact:{firstName:string;email:string}}
    expect(path).toBe('/api/admin/onboarding/drafts/123e4567-e89b-42d3-a456-426614174000/crm/contacts')
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.contact).toMatchObject({firstName:'Мария',email:'maria@example.org'})
    expect(Object.keys(body)).toEqual(['requestKey','contact'])
    expect(screen.getByRole('textbox',{name:'Имя *'})).toHaveValue('')
  })

  it('locks data and reuses exactly the same request key after uncertain 503',async()=>{
    writer.mockRejectedValueOnce(new ApiError(503,'TENANT_CRM_CONTACT_ACCESS_UNAVAILABLE','unconfirmed'))
      .mockImplementationOnce(async(_path,body)=>confirmed(body) as never)
    renderForm();fill()
    fireEvent.click(screen.getByRole('button',{name:'Создать контакт'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('повторите с тем же ключом')
    expect(screen.getByRole('textbox',{name:'Имя *'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'Повторить с тем же ключом'}))
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Контакт №93 создан'))
    expect(writer).toHaveBeenCalledTimes(2)
    expect(writer.mock.calls[0]![1]).toEqual(writer.mock.calls[1]![1])
  })

  it('does not present malformed success as a completed write and preserves replay key',async()=>{
    writer.mockResolvedValueOnce({schemaVersion:1,contact:{id:'93'}})
    renderForm();fill()
    fireEvent.click(screen.getByRole('button',{name:'Создать контакт'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Подтверждение не получено')
    expect(screen.getByRole('button',{name:'Повторить с тем же ключом'})).toBeEnabled()
    expect(screen.queryByText(/Контакт №93 создан/)).not.toBeInTheDocument()
  })

  it('allows correction after definitive duplicate refusal, without reusing an old key',async()=>{
    writer.mockRejectedValueOnce(new ApiError(409,'TENANT_CRM_CONTACT_DUPLICATE','duplicate'))
      .mockImplementationOnce(async(_path,body)=>confirmed(body) as never)
    renderForm();fill()
    fireEvent.click(screen.getByRole('button',{name:'Создать контакт'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('уже используется')
    expect(screen.getByRole('textbox',{name:'Email'})).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox',{name:'Email'}),{target:{value:'new@example.org'}})
    fireEvent.click(screen.getByRole('button',{name:'Создать контакт'}))
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Контакт №93 создан'))
    const first=writer.mock.calls[0]![1] as {requestKey:string}
    const second=writer.mock.calls[1]![1] as {requestKey:string}
    expect(first.requestKey).not.toBe(second.requestKey)
  })
})
