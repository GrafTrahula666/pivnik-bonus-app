import type { Pool, PoolClient } from 'pg'

export type AdminRole = 'SUPER_ADMIN' | 'VENUE_ADMIN'
export type Db = Pick<Pool, 'query' | 'connect'> | Pick<PoolClient, 'query'>

export interface AdminPrincipal {
  id: string
  email: string
  displayName: string
  role: AdminRole
}
export interface VenueScope {
  id: string
  companyId: string
  companyCode: string
  companyName: string
  code: string
  name: string
  address: string | null
  legacyBarId: string | null
}
export interface PeriodRange { from: Date; to: Date; days: number }

export class HttpError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}
