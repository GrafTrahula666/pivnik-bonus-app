export interface CrmActivationSummary {
  schemaVersion:1
  draftId:string
  scope:{companyId:string|null;venueId:string|null}
  status:'not_configured'|'pending'|'verifying'|'failed'|'degraded'
  code:string
  nextAction:string
  attemptCount:number|null
  updatedAt:string|null
  evidence:'not_checked'|'saved_activation_check'|'unavailable'
  crmStatus:'not_provisioned'
  activationAllowed:false
  guestApplicationRequired:false
}
export function validCrmActivationSummary(raw:unknown,venue:{kind:string;id:string;companyId:string|null;venueId:string|null;status:string}):raw is CrmActivationSummary{
  if(!raw||typeof raw!=='object')return false
  const value=raw as Record<string,unknown>,scope=value.scope as CrmActivationSummary['scope']|undefined
  return venue.kind==='draft'&&venue.status!=='active'&&value.schemaVersion===1&&value.draftId===venue.id&&
    !!scope&&scope.companyId===venue.companyId&&scope.venueId===venue.venueId&&
    ['not_configured','pending','verifying','failed','degraded'].includes(String(value.status))&&
    typeof value.code==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/.test(value.code)&&
    typeof value.nextAction==='string'&&!!value.nextAction.trim()&&value.nextAction.length<=1000&&
    (value.attemptCount===null||(Number.isSafeInteger(value.attemptCount)&&Number(value.attemptCount)>=0))&&
    (value.updatedAt===null||(typeof value.updatedAt==='string'&&Number.isFinite(Date.parse(value.updatedAt))))&&
    ['not_checked','saved_activation_check','unavailable'].includes(String(value.evidence))&&
    (value.evidence!=='not_checked'||(value.updatedAt===null&&value.status==='not_configured'))&&
    (value.evidence!=='saved_activation_check'||(typeof value.updatedAt==='string'&&typeof value.attemptCount==='number'&&value.status!=='not_configured'))&&
    (value.evidence!=='unavailable'||(value.attemptCount===null&&value.updatedAt===null&&value.status==='degraded'))&&
    value.crmStatus==='not_provisioned'&&value.activationAllowed===false&&value.guestApplicationRequired===false
}
