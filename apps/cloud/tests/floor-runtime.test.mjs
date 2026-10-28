import test from "node:test";
import assert from "node:assert/strict";
import { refreshFloor } from "../dist/floor-runtime.js";

const section = { id: "section", name: "Garden", kind: "section", status: "active", parentId: null, storefrontId: null, capacity: 30 };
const table = { id: "table", name: "Table 7", kind: "table", status: "active", parentId: "section", storefrontId: "shop", capacity: 4 };
const seat = { id: "seat", name: "Seat 1", kind: "seat", status: "active", parentId: "table", storefrontId: "shop", capacity: 1 };
const snapshot = () => ({ event: { id: "venue" }, stores: [{ id: "shop" }, { id: "other-shop" }], sections: [], tables: [{ id: "table", status: "occupied", assignedWaiter: "Ada" }], seats: [{ id: "seat", status: "occupied" }], orders: [], menuItems: [{ id: "food", price: 2000 }], inventory: [{ id: "food-stock", quantity: 12 }], payments: [{ id: "payment", amount: 2000 }] });

test("floor updates preserve service transactions, stock, table state and waiter assignments", () => {
  const s = snapshot(); const original = JSON.stringify({ inventory: s.inventory, menu: s.menuItems, payments: s.payments, orders: s.orders });
  refreshFloor(s, [section, table, seat]);
  assert.equal(s.tables[0].section, "Garden"); assert.equal(s.tables[0].status, "occupied"); assert.equal(s.tables[0].assignedWaiter, "Ada"); assert.equal(s.seats[0].status, "occupied");
  assert.equal(JSON.stringify({ inventory: s.inventory, menu: s.menuItems, payments: s.payments, orders: s.orders }), original);
});
test("floor changes cannot orphan active places or historical order references", () => {
  assert.throws(() => refreshFloor(snapshot(), [{ ...section, status: "archived" }, table]), /active section/);
  assert.throws(() => refreshFloor(snapshot(), [section, { ...table, capacity: 1 }, seat, { ...seat, id: "seat-2" }]), /capacity/);
  const s = snapshot(); s.orders.push({ storeId: "shop", tableId: "table" });
  assert.throws(() => refreshFloor(s, [section]), /used by an order/);
  assert.throws(() => refreshFloor(s, [section, { ...table, storefrontId: "other-shop" }]), /another storefront/);
  s.orders[0].seatId = "seat";
  assert.throws(() => refreshFloor(s, [section, table]), /seat used by an order/);
});
