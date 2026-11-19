const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:12345678@localhost:5432/punto-venta?schema=public" });
(async () => {
  await c.connect();
  const s = await c.query('select id, code, name from store order by name limit 5');
  console.log("tiendas:", JSON.stringify(s.rows, null, 2));
  const l = await c.query("select count(*)::int as n from installation");
  const sl = await c.query("select count(*)::int as n from store_license");
  const cl = await c.query("select count(*)::int as n from caja_license");
  const ev = await c.query("select count(*)::int as n from license_event");
  console.log("installation:", l.rows[0].n, "store_license:", sl.rows[0].n, "caja_license:", cl.rows[0].n, "license_event:", ev.rows[0].n);
  await c.end();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
