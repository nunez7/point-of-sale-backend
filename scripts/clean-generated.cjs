// Elimina los fuentes .ts generados por Prisma una vez compilados a .js + .d.ts,
// para que TypeScript resuelva el import del cliente al .d.ts (tipos) y Node al .js (runtime),
// evitando que el .ts quede dentro del programa y rompa la validación de rootDir.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "generated");

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      fs.unlinkSync(full);
    }
  }
}

if (fs.existsSync(root)) {
  walk(root);
  console.log("Archivos .ts generados por Prisma eliminados (se conservan .js y .d.ts).");
}
