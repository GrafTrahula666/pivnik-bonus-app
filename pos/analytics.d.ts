export interface PosDocument {
  source: string; storeId: string; documentId: string; type: 'SELL' | 'PAYBACK';
  closedAt: string; amountCents: number; clientId: string | null;
  positions: Array<{productId: string | null; name: string; measure: string; quantityMillis: number; amountCents: number}>;
  payments: Array<{type: string; method: string; amountCents: number}>;
  receiptCount: number | null; linkable: boolean;
}
export interface PosSummary {
  salesCents: string; returnsCents: string; netCents: string;
  saleDocuments: number; returnDocuments: number; receiptCount: number | null;
  averageCents: string | null; activeBuyers?: number; repeatBuyers?: number;
  repeatPurchaseRate?: number | null; purchaseFrequency?: number | null;
  days: Array<{label: string; amountCents: string}>;
  payments: Array<{label: string; amountCents: string}>;
}
export function posDashboards(documents: PosDocument[]): {
  all: PosSummary; app: PosSummary; unlinked: PosSummary; linkedRevenueSharePercent: number | null;
};
