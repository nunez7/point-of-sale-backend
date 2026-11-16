// Verifica que el cliente Prisma generado exista, esté completo y sea más nuevo que el schema.
// Si algo no cuadra, ejecuta el pipeline completo (prisma generate + tsc + limpieza de .ts).
//
// Motivo: generated/ está en .gitignore, así que tras un clone/pull no existe y TypeScript
// reporta TS2307 ("Cannot find module .../generated/prisma/client.js") más cientos de errores
// en cascada (TS7006, TS2339, TS2538, TS18046) en todo el proyecto. También cubre el caso de
// una regeneración a medias (quedan .ts junto a .js/.d.ts y rompen rootDir) y el de un cliente
// obsoleto después de cambiar prisma/schema.prisma.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const generatedDir = path.join(root, "generated");
const clientDts = path.join(generatedDir, "prisma", "client.d.ts");
const schemaFile = path.join(root, "prisma", "schema.prisma");

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Los fuentes .ts generados por Prisma deben eliminarse tras compilarlos a .js + .d.ts;
// si sobreviven, TypeScript los resuelve y falla con TS6059 (fuera de rootDir ./src).
function hasTsSources(dir) {
  if (!fs.existsSync(dir)) return false;

  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (hasTsSources(full)) return true;
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      return true;
    }
  }

  return false;
}

function staleReason() {
  if (!fs.existsSync(clientDts)) return "no existe generated/prisma/client.d.ts";
  if (hasTsSources(generatedDir)) return "quedaron fuentes .ts del cliente sin compilar";
  if (mtime(clientDts) < mtime(schemaFile)) return "el cliente es más antiguo que prisma/schema.prisma";
  return null;
}

const reason = staleReason();

if (!reason) {
  console.log("Cliente Prisma al día.");
  process.exit(0);
}

console.log(`Cliente Prisma desactualizado (${reason}). Regenerando...`);

// prisma.config.ts exige DATABASE_URL para cargarse, aunque "generate" no se conecta a la BD
// (por eso se usa un valor de relleno cuando el .env todavía no existe, p. ej. en postinstall).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres";
  console.log("DATABASE_URL no definida: se usa un valor de relleno solo para generar el cliente.");
}

try {
  execSync("npm run prisma:generate", { cwd: root, stdio: "inherit", env: process.env });
} catch {
  console.error("No se pudo generar el cliente Prisma. Revisa los errores anteriores.");
  process.exit(1);
}

if (!fs.existsSync(clientDts)) {
  console.error("La generación terminó pero generated/prisma/client.d.ts no existe.");
  process.exit(1);
}

console.log("Cliente Prisma regenerado correctamente.");
