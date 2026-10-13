import type { PosDocument } from './analytics.js';
export interface PosReadDb { query(sql: string, args?: unknown[]): Promise<{rows: Record<string, unknown>[]}> }
export interface PosConnection { state: string; lastSuccessAt: string | Date | null; errorCode?: string | null; historyComplete?: boolean }
export function loadPosDocuments(db: PosReadDb, storeId: string, period: {from: string; until: string}): Promise<PosDocument[]>;
export function posConnectionStatus(db: PosReadDb, config: {enabled: boolean; token?: string; storeId: string; readOnly?: boolean}): Promise<PosConnection>;
