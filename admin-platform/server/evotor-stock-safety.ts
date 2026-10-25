import {HttpError} from './types.js'

// Cloud V2 PATCH assigns an absolute quantity. Neither a CRM lock nor a second
// GET serializes it with terminal sales. No supported atomic delta/CAS contract
// has been verified for this integration. A feature flag is not that proof.
export const stockWriteBlock={
  code:'EVOTOR_STOCK_CONCURRENCY_UNSUPPORTED',
  message:'Добавление пока недоступно: не подтверждён способ обновления остатка без потери одновременных продаж на кассе.',
} as const

export function requireSafeStockIncrement():void {
  throw new HttpError(503,stockWriteBlock.code,stockWriteBlock.message)
}
