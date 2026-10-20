export function summarizeInvoices(orders) {
  const totals = { count: 0, amount: 0, discounted: 0 };
  for (const order of orders) {
    totals.count += 1;
    totals.amount += order.price * order.quantity;
    if (order.discount !== undefined) {
      totals.discounted += order.price * order.quantity * order.discount;
    }
  }
  return { ...totals, average: totals.count === 0 ? 0 : totals.amount / totals.count };
}
