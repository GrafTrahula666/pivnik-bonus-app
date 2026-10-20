export const POS_ONBOARDING_PROTOCOL:string
export const POS_DEVICE_KEY_PATTERN:RegExp
export const POS_EVENT_FRESH_MS:number
export const POS_SYNC_FRESH_MS:number
export interface PosOnboardingPacket {
 protocol:string;challenge:string;observedAt:string
 runtime:{key:string;checksum:string;companyId:string;venueId:string;status:'not_provisioned'}
 device:{id:string;externalId:string;storeId:string}
 lastEvent:{id:string;receivedAt:string}|null
 provider:{state:'not_connected'|'schema_required'|'error'|'syncing'|'connected'|'awaiting_sync';lastSuccessAt:string|null}
 report:{state:'available'|'unavailable';empty:boolean|null;period:{from:string;until:string}|null}
}
export function signPosOnboardingPacket(packet:PosOnboardingPacket,key:string):string
export function verifyPosOnboardingPacket(raw:unknown,key:string,expected:{challenge:string;runtimeKey:string;checksum:string;companyId:string;venueId:string;storeId:string;terminalId:string},now?:number):PosOnboardingPacket
