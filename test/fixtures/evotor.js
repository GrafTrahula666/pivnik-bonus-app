export function sale(overrides = {}) {
  return { id: 'sale-1', store_id: 'bar', type: 'SELL', close_date: '2026-10-01T21:00:00.000+0000', number: 7,
    body: { result_sum: 0.3, positions: [{ product_name: 'Пиво', quantity: 0.5, result_sum: 0.3 }],
      payments: [{ payment: { type: 'CASH', sum: 0.3 } }], pos_print_results: [{ pos_print_result: { receipt_number: 7 } }] }, ...overrides };
}
