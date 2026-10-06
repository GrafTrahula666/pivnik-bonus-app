export function summarizePos(documents) {
  let sales = 0n, returns = 0n, receipts = 0, unknownReceipts = 0, returnDocs = 0;
  const buyers = new Map(), days = new Map(), hours = new Map(), products = new Map(), payments = new Map();
  const add = (map, key, cents) => map.set(key, (map.get(key) || 0n) + cents);
  const localTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const salesDocs = documents.filter((d) => d.type === 'SELL');
  for (const doc of documents) {
    const refund = doc.type === 'PAYBACK', sign = refund ? -1n : 1n, cents = BigInt(doc.amountCents);
    if (refund) { returns += cents; returnDocs++; }
    else {
      sales += cents;
      if (doc.receiptCount == null) unknownReceipts++; else receipts += doc.receiptCount;
      if (doc.clientId) buyers.set(doc.clientId, (buyers.get(doc.clientId) || 0) + 1);
    }
    const local = localTime.format(new Date(doc.closedAt));
    add(days, local.slice(0, 10), sign * cents); add(hours, local.slice(-2), sign * cents);
    for (const p of doc.positions) {
      const key = JSON.stringify([p.productId, p.name, p.measure]);
      const item = products.get(key) || { name: p.name, measure: p.measure, quantityMillis: 0n, salesCents: 0n, returnCents: 0n };
      item.quantityMillis += sign * BigInt(p.quantityMillis);
      item[refund ? 'returnCents' : 'salesCents'] += BigInt(p.amountCents); products.set(key, item);
    }
    for (const p of doc.payments) add(payments, p.type + (p.method ? ` / ${p.method}` : ''), sign * BigInt(p.amountCents));
  }
  const sumRows = (map) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, amountCents: String(value) }));
  return {
    salesCents: String(sales), returnsCents: String(returns), netCents: String(sales - returns),
    saleDocuments: salesDocs.length, returnDocuments: returnDocs, receiptCount: unknownReceipts ? null : receipts,
    knownReceiptCount: receipts, documentsWithoutReceiptCount: unknownReceipts,
    averageCents: !unknownReceipts && receipts ? String((sales + BigInt(Math.floor(receipts / 2))) / BigInt(receipts)) : null,
    activeBuyers: buyers.size, repeatBuyers: [...buyers.values()].filter((n) => n > 1).length,
    repeatPurchaseRate: buyers.size ? Number(BigInt([...buyers.values()].filter((n) => n > 1).length) * 10000n / BigInt(buyers.size)) / 100 : null,
    purchaseFrequency: buyers.size ? salesDocs.length / buyers.size : null,
    linkedSaleDocuments: salesDocs.filter((d) => d.clientId).length,
    unlinkedSaleDocuments: salesDocs.filter((d) => !d.clientId).length,
    days: sumRows(days), hours: sumRows(hours), payments: sumRows(payments),
    products: [...products.values()].map((p) => ({ name: p.name, measure: p.measure,
      quantityMillis: String(p.quantityMillis), salesCents: String(p.salesCents), returnCents: String(p.returnCents), netCents: String(p.salesCents - p.returnCents) }))
  };
}

export function posDashboards(documents) {
  const all = summarizePos(documents), app = summarizePos(documents.filter((d) => d.clientId));
  const total = BigInt(all.salesCents), linked = BigInt(app.salesCents);
  // Cohort is a projection of the same documents, NEVER an additional revenue stream.
  if (linked > total) throw new Error('Клиентские продажи превышают общую кассу.');
  // Anonymous customer identity/CRM cannot be calculated from cash documents.
  const unlinked = summarizePos(documents.filter((d) => !d.clientId));
  for (const field of ['activeBuyers','repeatBuyers','repeatPurchaseRate','purchaseFrequency']) { delete all[field]; delete unlinked[field]; }
  return { all, app, unlinked,
    linkedRevenueSharePercent: total ? Number(linked * 10000n / total) / 100 : null };
}
