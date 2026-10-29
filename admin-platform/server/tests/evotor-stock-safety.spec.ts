// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import type {AdminPrincipal,VenueScope} from '../types.js'

const state=vi.hoisted(()=>({
  flags:{enableBeerIntake:true,enableWrites:true,enableEvotorStockWrites:true},
  connect:vi.fn(),query:vi.fn(),tableExists:vi.fn(),audit:vi.fn(),
  list:vi.fn(),get:vi.fn(),patch:vi.fn(),
}))
vi.mock('../config.js',()=>({config:state.flags}))
vi.mock('../db.js',()=>({pool:{connect:state.connect},readPool:{query:state.query},tableExists:state.tableExists}))
vi.mock('../audit.js',()=>({recordAudit:state.audit}))
vi.mock('../evotor-stock-client.js',()=>({getEvotorStockList:state.list,getEvotorStockProduct:state.get,patchEvotorStockQuantity:state.patch}))
import {incrementEvotorStock,listEvotorStock} from '../evotor-stock.js'

const scope:VenueScope={id:'1',companyId:'1',companyCode:'pivnik',companyName:'ПИВНИК',code:'pivnik',name:'ПИВНИК',address:null,legacyBarId:null}
const admin:AdminPrincipal={id:'1',email:'owner@fixture.invalid',displayName:'Owner',role:'VENUE_ADMIN'}
const body={productId:'real-selected-product-id',expectedQuantity:25,expectedUpdatedAt:'2026-10-25T12:00:00Z',liters:50,operationId:'11111111-1111-4111-8111-111111111111'}

describe('Evotor stock write safety boundary',()=>{
  beforeEach(()=>{vi.clearAllMocks();Object.assign(state.flags,{enableBeerIntake:true,enableWrites:true,enableEvotorStockWrites:true})})
  afterEach(()=>vi.unstubAllEnvs())
  it('blocks before any reservation, DB write or provider call even with all flags enabled',async()=>{
    await expect(incrementEvotorStock(admin,scope,body)).rejects.toMatchObject({statusCode:503,code:'EVOTOR_STOCK_CONCURRENCY_UNSUPPORTED'})
    for(const spy of [state.connect,state.query,state.tableExists,state.audit,state.get,state.patch])expect(spy).not.toHaveBeenCalled()
  })
  it('retains the existing default-off controls',async()=>{
    state.flags.enableEvotorStockWrites=false
    await expect(incrementEvotorStock(admin,scope,body)).rejects.toMatchObject({statusCode:403,code:'EVOTOR_STOCK_WRITE_DISABLED'})
    expect(state.connect).not.toHaveBeenCalled();expect(state.patch).not.toHaveBeenCalled()
  })
  it('does not advertise unsafe writes while preserving actual product IDs and quantities',async()=>{
    vi.stubEnv('EVOTOR_API_TOKEN','fixture-only-token');vi.stubEnv('EVOTOR_STORE_ID','store-1')
    state.query.mockResolvedValueOnce({rows:[{exists:true}]}).mockResolvedValueOnce({rows:[{store_id:'store-1'}]})
    const products=[{id:body.productId,name:'Хадыженское',quantity:24,measure_name:'л',updated_at:body.expectedUpdatedAt,store_id:'store-1',type:'NORMAL'}]
    state.list.mockResolvedValue(products)
    expect(await listEvotorStock(scope)).toMatchObject({source:'evotor_cloud',writeEnabled:false,writeBlock:{code:'EVOTOR_STOCK_CONCURRENCY_UNSUPPORTED'},products})
    expect(state.list).toHaveBeenCalledWith('store-1','fixture-only-token')
    expect(state.patch).not.toHaveBeenCalled();expect(state.connect).not.toHaveBeenCalled()
  })
})
