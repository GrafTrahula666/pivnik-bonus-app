import crypto from 'node:crypto'
import { config } from './config.js'
import { readPool, writePool } from './db.js'
import { recordAudit } from './audit.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

// The guest app reads its promotions from `promotions` and its look from `app_settings.published`
// (server.js). Business edits those same rows so a change reaches guests on their next app load.

function requirePivnik(scope:VenueScope):void {
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId){
    throw new HttpError(409,'APP_CONTENT_NOT_LINKED','Это заведение пока не связано с приложением ПИВНИК.')
  }
}
function requireAppWriter(scope:VenueScope){
  if(!config.enableWrites) throw new HttpError(405,'WRITES_DISABLED','Изменения отключены на этом окружении.')
  requirePivnik(scope)
  if(!writePool) throw new HttpError(503,'PRODUCTION_WRITER_UNAVAILABLE','Запись в приложение не настроена.')
  return writePool
}

const text=(value:unknown,max:number)=>String(value??'').trim().slice(0,max)

export interface AppPromotion {
  id:string; code:string; title:string; description:string; badge:string
  imageSrc:string; active:boolean; sortOrder:number; updatedAt:string|null
}
interface PromotionRow {
  id:string; code:string; title:string; description:string|null; badge:string|null
  image_src:string|null; active:boolean; sort_order:number; updated_at:string|null
}
const promotion=(r:PromotionRow):AppPromotion=>({
  id:String(r.id),code:r.code,title:r.title,description:r.description||'',badge:r.badge||'',
  imageSrc:r.image_src||'',active:Boolean(r.active),sortOrder:Number(r.sort_order||0),updatedAt:r.updated_at,
})

export interface PromotionInput { title:string; description:string; badge:string; active:boolean; sortOrder:number; imageSrc?:string|null }

// Same limits as the guest app's own admin (server.js normalizeContentImage).
export const MAX_PROMOTION_IMAGE_BYTES=3_200_000
export const PROMOTION_BODY_LIMIT=MAX_PROMOTION_IMAGE_BYTES+64*1024

// Uploaded pictures are data URLs of up to 3 MB; the audit log keeps a marker instead of the picture.
const auditPromotion=(p:AppPromotion)=>p.imageSrc.startsWith('data:')?{...p,imageSrc:'[загруженное изображение]'}:p

// imageSrc: omitted keeps the current picture, '' removes it.
export function validatePromotionInput(raw:unknown):PromotionInput {
  const b=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>
  const title=text(b.title,120)
  if(!title) throw new HttpError(400,'TITLE_REQUIRED','Укажите название акции.')
  const sortOrder=Math.max(-9999,Math.min(9999,Math.trunc(Number(b.sortOrder||0))))
  const out:PromotionInput={title,description:text(b.description,500),badge:text(b.badge,40),active:b.active!==false,sortOrder:Number.isFinite(sortOrder)?sortOrder:0}
  if(b.imageSrc!==undefined&&b.imageSrc!==null){
    const src=String(b.imageSrc).trim()
    if(/^data:image\/(jpeg|png|webp);base64,/i.test(src)){
      if(Buffer.byteLength(src,'utf8')>MAX_PROMOTION_IMAGE_BYTES) throw new HttpError(400,'IMAGE_TOO_LARGE','Картинка больше 3 МБ.')
    }else if(src&&!(/^\/assets\/[a-z0-9_./-]+$/i.test(src)||(/^https:\/\/\S+$/i.test(src)&&src.length<=2000))){
      throw new HttpError(400,'IMAGE_INVALID','Картинка: JPG, PNG, WEBP или ссылка https://.')
    }
    out.imageSrc=src||null
  }else if(b.imageSrc===null) out.imageSrc=null
  return out
}

function promotionId(raw:string):string {
  if(!/^\d{1,18}$/.test(raw)) throw new HttpError(400,'INVALID_ID','Некорректная акция.')
  return raw
}

export async function listAppPromotions(scope:VenueScope):Promise<{items:AppPromotion[]}> {
  requirePivnik(scope)
  const r=await readPool.query<PromotionRow>('SELECT id,code,title,description,badge,image_src,active,sort_order,updated_at FROM promotions ORDER BY sort_order,id')
  return {items:r.rows.map(promotion)}
}

export async function createAppPromotion(admin:AdminPrincipal,scope:VenueScope,raw:unknown):Promise<AppPromotion> {
  const db=requireAppWriter(scope),v=validatePromotionInput(raw)
  const code=`promo-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const r=await db.query<PromotionRow>(
    `INSERT INTO promotions(code,title,description,badge,image_src,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,code,title,description,badge,image_src,active,sort_order,updated_at`,
    [code,v.title,v.description,v.badge,v.imageSrc??null,v.active,v.sortOrder])
  const after=promotion(r.rows[0]!)
  await recordAudit({admin,scope,action:'app.promotion_create',entityType:'app_promotion',entityId:after.id,after:auditPromotion(after)})
  return after
}

export async function updateAppPromotion(admin:AdminPrincipal,scope:VenueScope,rawId:string,raw:unknown):Promise<AppPromotion> {
  const db=requireAppWriter(scope),id=promotionId(rawId),v=validatePromotionInput(raw)
  const client=await db.connect()
  try{
    await client.query('BEGIN')
    const before=await client.query<PromotionRow>('SELECT id,code,title,description,badge,image_src,active,sort_order,updated_at FROM promotions WHERE id=$1 FOR UPDATE',[id])
    if(!before.rowCount) throw new HttpError(404,'NOT_FOUND','Акция не найдена.')
    const r=await client.query<PromotionRow>(
      `UPDATE promotions SET title=$1,description=$2,badge=$3,image_src=$4,active=$5,sort_order=$6,updated_by=NULL,updated_at=NOW()
       WHERE id=$7 RETURNING id,code,title,description,badge,image_src,active,sort_order,updated_at`,
      [v.title,v.description,v.badge,v.imageSrc===undefined?before.rows[0]!.image_src:v.imageSrc,v.active,v.sortOrder,id])
    await client.query('COMMIT')
    const after=promotion(r.rows[0]!)
    await recordAudit({admin,scope,action:'app.promotion_update',entityType:'app_promotion',entityId:id,before:auditPromotion(promotion(before.rows[0]!)),after:auditPromotion(after)})
    return after
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
}

export async function deleteAppPromotion(admin:AdminPrincipal,scope:VenueScope,rawId:string):Promise<{ok:true}> {
  const db=requireAppWriter(scope),id=promotionId(rawId)
  const r=await db.query<PromotionRow>('DELETE FROM promotions WHERE id=$1 RETURNING id,code,title,description,badge,image_src,active,sort_order,updated_at',[id])
  if(!r.rowCount) throw new HttpError(404,'NOT_FOUND','Акция не найдена.')
  // The row goes to the audit log, so a deleted promotion can be restored from it.
  await recordAudit({admin,scope,action:'app.promotion_delete',entityType:'app_promotion',entityId:id,before:auditPromotion(promotion(r.rows[0]!))})
  return {ok:true}
}

// Only these blocks exist on the guest home screen (index.html data-config-section, plus the byline).
export const APP_SECTIONS=['promos','team','byline'] as const
export const APP_TEXTS=['brand','balanceLabel','byline','qrButton'] as const
type Section=(typeof APP_SECTIONS)[number]
type TextKey=(typeof APP_TEXTS)[number]
export interface AppDesign {
  texts:Record<TextKey,string>
  sections:Record<Section,boolean>
  radius:number
  theme:'default'|'halloween'
}
type StoredDesign=Record<string,unknown>&{texts?:Record<string,unknown>;sections?:Record<string,unknown>;radius?:unknown;theme?:unknown}

function designView(d:StoredDesign):AppDesign {
  const texts=Object.fromEntries(APP_TEXTS.map(k=>[k,String(d.texts?.[k]??'')])) as Record<TextKey,string>
  const sections=Object.fromEntries(APP_SECTIONS.map(k=>[k,d.sections?.[k]!==false])) as Record<Section,boolean>
  return {texts,sections,radius:Number(d.radius)||20,theme:d.theme==='halloween'?'halloween':'default'}
}

export function validateDesignInput(raw:unknown):AppDesign {
  const b=(raw&&typeof raw==='object'?raw:{}) as Record<string,any>
  const texts=Object.fromEntries(APP_TEXTS.map(k=>[k,text(b.texts?.[k],60)])) as Record<TextKey,string>
  if(!texts.brand) throw new HttpError(400,'BRAND_REQUIRED','Укажите название заведения.')
  const sections=Object.fromEntries(APP_SECTIONS.map(k=>[k,b.sections?.[k]!==false])) as Record<Section,boolean>
  const radius=Math.trunc(Number(b.radius))
  if(!Number.isFinite(radius)||radius<8||radius>36) throw new HttpError(400,'RADIUS_INVALID','Скругление: от 8 до 36.')
  if(b.theme!=='default'&&b.theme!=='halloween') throw new HttpError(400,'THEME_INVALID','Неизвестная тема.')
  return {texts,sections,radius,theme:b.theme}
}

function overlayDesign(base:StoredDesign,v:AppDesign):StoredDesign {
  const next:StoredDesign={...base,texts:{...(base.texts||{}),...v.texts},sections:{...(base.sections||{}),...v.sections},radius:v.radius}
  if(v.theme==='halloween') next.theme='halloween'
  else delete next.theme
  return next
}

export async function getAppDesign(scope:VenueScope):Promise<{design:AppDesign;draftPending:boolean;updatedAt:string|null}> {
  requirePivnik(scope)
  const r=await readPool.query<{draft:StoredDesign;published:StoredDesign;updated_at:string|null}>('SELECT draft,published,updated_at FROM app_settings WHERE id=1')
  if(!r.rowCount) throw new HttpError(503,'APP_SETTINGS_MISSING','В приложении нет настроек оформления.')
  const row=r.rows[0]!
  return {design:designView(row.published),draftPending:JSON.stringify(row.draft)!==JSON.stringify(row.published),updatedAt:row.updated_at}
}

// Overlays only the fields Business edits onto the published design (keeping version, colors and splash)
// and onto the in-app admin's draft, so an unpublished draft there keeps its other changes.
export async function publishAppDesign(admin:AdminPrincipal,scope:VenueScope,raw:unknown):Promise<{design:AppDesign}> {
  const db=requireAppWriter(scope),v=validateDesignInput(raw)
  const client=await db.connect()
  try{
    await client.query('BEGIN')
    const r=await client.query<{draft:StoredDesign;published:StoredDesign}>('SELECT draft,published FROM app_settings WHERE id=1 FOR UPDATE')
    if(!r.rowCount) throw new HttpError(503,'APP_SETTINGS_MISSING','В приложении нет настроек оформления.')
    const stored=r.rows[0]!,before=stored.published
    const next=overlayDesign(before,v),draft=overlayDesign(stored.draft||before,v)
    await client.query('UPDATE app_settings SET draft=$1::jsonb,published=$2::jsonb,updated_by=NULL,updated_at=NOW() WHERE id=1',[JSON.stringify(draft),JSON.stringify(next)])
    await client.query('COMMIT')
    await recordAudit({admin,scope,action:'app.design_publish',entityType:'app_design',entityId:'1',before:designView(before),after:v})
    return {design:designView(next)}
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
}
