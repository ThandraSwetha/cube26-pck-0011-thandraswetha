import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const sampleCsvPath = fileURLToPath(new URL("../../data/pack_sample.csv", import.meta.url));

function parseOrderLines(orderLines) {
  return orderLines.split(";").filter(Boolean).map((line) => {
    const separator = line.lastIndexOf(":");
    const sku = line.slice(0, separator).trim();
    const quantity = Number(line.slice(separator + 1));
    if (!sku || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Invalid order line in sample data: ${line}`);
    }
    return { sku, name: sku, quantity };
  });
}

async function loadSeedOrders() {
  const csv = await readFile(sampleCsvPath, "utf8");
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
  return rows.map((row) => ({
    orgId: row.org_id,
    unitId: row.unit_id,
    orderId: row.order_id,
    channel: row.channel,
    expectedItems: parseOrderLines(row.order_lines),
  }));
}

async function seedOrders(database, orders) {
  for (const order of orders) {
    await database.db.query(
      `INSERT INTO orders (org_id, unit_id, order_id, channel, expected_items)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (org_id, unit_id) DO NOTHING`,
      [order.orgId, order.unitId, order.orderId, order.channel, JSON.stringify(order.expectedItems)],
    );
  }
}

export { loadSeedOrders, parseOrderLines, seedOrders };