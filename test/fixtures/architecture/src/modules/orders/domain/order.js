import { saveOrder } from "../infrastructure/order-repository.js";

export function placeOrder(order) {
  return saveOrder(order);
}
