// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {buildVenueScopeQuery} from '../tenant.js'
import {getAuthorizedVenueComparison,parseComparisonVenueIds} from '../venue-comparison.js'
import {HttpError,type AdminPrincipal,type VenueScope} from '../types.js'

const admin:AdminPrincipal={id:'11',role:'VENUE_ADMIN',email:'test@invalid',displayName:'Test'}
const scopes:Record<string,VenueScope>={
  '101':{id:'101',companyId:'10',companyCode:'a',companyName:'Company A',code:'a1',name:'Venue A1',address:null,legacyBarId:null},
  '102':{id:'102',companyId:'10',companyCode:'a',companyName:'Company A',code:'a2',name:'Venue A2',address:null,legacyBarId:null},
  '201':{id:'201',companyId:'20',companyCode:'b',companyName:'Company B',code:'b1',name:'Venue B1',address:null,legacyBarId:null},
}
const url=(ids:string)=>new URL('https://fixture.invalid/api/admin/venue-comparison?venueIds='+encodeURIComponent(ids)+'&date=2026-10-02')
const makeDeps=(opts:{deny?:string;unavailable?:string;failure?:string}={})=>{
  const calls:string[]=[]
  const db={query:async(sql:string)=>{calls.push(sql.split(' ')[0]!);return {rows:[]}},release:()=>calls.push('RELEASE')}
  const operations={
    resolveScope:async(_admin:AdminPrincipal,id:string)=>{
      calls.push('resolve:'+id)
      if(!scopes[id]||opts.deny===id)throw new HttpError(404,'VENUE_NOT_FOUND','Недоступно')
      return scopes[id]!
    },
    requireAccess:async(_admin:AdminPrincipal,scope:VenueScope)=>{
      calls.push('authorize:'+scope.id)
      if(opts.deny===scope.id)throw new HttpError(403,'DIRECTOR_READ_FORBIDDEN','Нет доступа')
    },
    connect:async()=>{calls.push('CONNECT');return db},
    loadReport:async(_db:unknown,scope:VenueScope)=>{
      calls.push('report:'+scope.id)
      if(opts.failure===scope.id)throw new Error('REPORT_ERROR')
      return opts.unavailable===scope.id
        ?{connection:{state:'not_connected',lastSuccessAt:null},all:null}
        :{connection:{state:'connected',lastSuccessAt:'2026-10-03T00:00:00Z'},
          all:{salesCents:'9007199254740993',returnsCents:'9007199254740994',
            netCents:'-1',saleDocuments:1,returnDocuments:1,receiptCount:null}}
    },
  }
  return {calls,operations}
}
describe('venue comparison: strict validation and full-request permissions',()=>{
  it('accepts 2-6 unique bounded IDs and rejects SQL, duplicates and ambiguous parameters',()=>{
    expect(parseComparisonVenueIds(url('101,102'))).toEqual(['101','102'])
    for(const ids of ['', '101','101,101','0,102','101,-2','01,102',
      '101,102,201,202,203,204,205','101,9223372036854775808',
      '101,102 OR 1=1','101,','101,,102']){
      expect(()=>parseComparisonVenueIds(url(ids))).toThrow(HttpError)
    }
    const twice=url('101,102');twice.searchParams.append('venueIds','201,202')
    expect(()=>parseComparisonVenueIds(twice)).toThrow(HttpError)
  })
  it('authorizes all scopes before reads; returns nullable data and never invents money totals',async()=>{
    const {calls,operations}=makeDeps({unavailable:'102'})
    const result=await getAuthorizedVenueComparison(admin,url('101,102'),operations)
    expect(result.venues.map(v=>v.venueId)).toEqual(['101','102'])
    expect(result.venues[0]).toMatchObject({status:'observed',netCents:'-1',receiptCount:null})
    expect(result.venues[1]).toMatchObject({status:'unavailable',netCents:null,saleDocuments:null})
    expect(result.currency).toBeNull()
    expect(result.total).toBeNull()
    expect(result.comparableMoney).toBe(false)
    expect(result.comparisonMode).toBe('side_by_side_only')
    expect(result.period.timeZone).toBe('Europe/Moscow')
    expect(calls.indexOf('CONNECT')).toBeGreaterThan(calls.indexOf('authorize:102'))
    expect(calls.slice(-2)).toEqual(['COMMIT','RELEASE'])
    expect(JSON.stringify(result)).not.toContain('clientId')
  })
  it('rejects inaccessible or cross-company venue without any POS read or partial response',async()=>{
    const deny=makeDeps({deny:'102'})
    await expect(getAuthorizedVenueComparison(admin,url('101,102'),deny.operations)).rejects.toMatchObject({statusCode:404})
    expect(deny.calls).not.toContain('CONNECT')
    const foreign=makeDeps()
    await expect(getAuthorizedVenueComparison(admin,url('101,201'),foreign.operations)).rejects.toMatchObject({code:'VENUE_COMPARISON_SCOPE'})
    expect(foreign.calls).not.toContain('CONNECT')
  })
  it('rolls back all reports if second venue fails',async()=>{
    const mock=makeDeps({failure:'102'})
    await expect(getAuthorizedVenueComparison(admin,url('101,102'),mock.operations)).rejects.toThrow('REPORT_ERROR')
    expect(mock.calls.slice(-2)).toEqual(['ROLLBACK','RELEASE'])
  })
})
describe('real tenant-scope SQL in disposable PostgreSQL/WASM',()=>{
  it('allows an owner two same-company venues but not another company',async()=>{
    const db=new PGlite()
    try{
      await db.exec(`CREATE TABLE companies(id BIGINT PRIMARY KEY,code TEXT,name TEXT,active BOOLEAN);
        CREATE TABLE venues(id BIGINT PRIMARY KEY,company_id BIGINT,code TEXT,name TEXT,address TEXT,legacy_bar_id BIGINT,active BOOLEAN);
        CREATE TABLE admin_company_access(company_id BIGINT,admin_id BIGINT);
        INSERT INTO companies VALUES(10,'a','A',TRUE),(20,'b','B',TRUE);
        INSERT INTO venues VALUES (101,10,'a1','Venue A1',NULL,NULL,TRUE),
          (102,10,'a2','Venue A2',NULL,NULL,TRUE),(201,20,'b1','Venue B1',NULL,NULL,TRUE);
        INSERT INTO admin_company_access VALUES(10,11);`)
      for(const id of ['101','102','201']){
        const stmt=buildVenueScopeQuery(admin,id)
        const row=await db.query(stmt.text,stmt.params)
        expect(row.rows.length).toBe(id==='201'?0:1)
      }
    }finally{await db.close()}
  })
})
