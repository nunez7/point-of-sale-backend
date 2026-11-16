# AGENTS.md

Express + TypeScript + Prisma + PostgreSQL + Socket.io POS multi-store backend. Spanish-domain codebase (all messages, errors, and comments in Spanish).

## Commands
- `npm run dev` — start dev server (ts-node-dev, `--transpile-only`, NO type checking)
- `npm run typecheck` — `tsc --noEmit`; always run after edits (`noUnusedLocals`/`noUnusedParameters`/strict are on)
- `npm run build` — `tsc -p tsconfig.json` to `dist/`
- `npm start` — run compiled `dist/server.js`
- `npm run prisma:generate` — `prisma generate` + compiles the generated TS client to `generated/` (`.js`+`.d.ts`) and removes the `.ts` sources
- `npm run prisma:migrate` — `prisma migrate dev` (reads `prisma.config.ts` for the DB URL)
- `npm run prisma:deploy` — apply migrations in prod
- `npm run prisma:studio` — open Prisma Studio
- `npm run prisma:seed` — `prisma db seed` (seed command defined in `prisma.config.ts`)
- No test/lint tooling is installed.

## Setup gotchas
- `.env` is required at package root; `src/config/env.ts` validates it with zod and **lanza un `Error` con la lista de variables faltantes/inválidas** (ya no `process.exit(1)`: en serverless el exit solo produce `FUNCTION_INVOCATION_FAILED` y se pierde el detalle). `src/server.ts` es el **entrypoint único**: carga `./app` con `require()` dentro de `try/catch`, hace `export default` de la app (o de una app de emergencia que responde 503 con `{ status, error, detalle }`) y solo abre el listener HTTP cuando `!process.env.VERCEL`. Así un fallo de arranque se diagnostica con `curl /health` (503 + detalle) en lugar de leer logs. **No crear una carpeta `api/` en la raíz**: Vercel la trata como namespace de funciones y rompe el routing de `/api/*` (responde 404 de plataforma) frente a la detección zero-config de Express. El entrypoint que Vercel realmente usa es **`index.ts` de la raíz** (solo `export default app` reexportando `src/server.ts`): Vercel prueba `app`/`index`/`server` en la raíz antes que los de `src/`, y si cae en `src/app.ts` (que solo tiene export nombrado) se salta el wrapper de diagnóstico y devuelve `FUNCTION_INVOCATION_FAILED` opaco. `index.ts` queda fuera de `tsconfig.include` (rootDir `src`), así que no lo compila `npm run build` ni lo revisa `npm run typecheck`; para validarlo: `npx tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --strict --esModuleInterop --skipLibCheck index.ts`. Copy `.env.example` (PostgreSQL `DATABASE_URL`, `JWT_SECRET`). The example's `PORT=4000` is stale — the frontend expects this server on 3001 (`PORT=3001` in `.env`).
- **IP restriction** (`src/middleware/ipAllowlist.ts`): `ALLOWED_IPS` (comma-separated, supports a suffix wildcard like `192.168.1.*`; empty = no restriction, rejected in production) gates HTTP before CORS and Socket.io during the handshake (`allowRequest`). `/health` is exempt. `IP_ALLOWLIST_ENABLED=false` desactiva el control completo (y los refinements de producción sobre `ALLOWED_IPS`) — necesario en hostings serverless (Vercel) donde la IP de origen cambia por petición; sin él `env.ts` aborta el arranque y Vercel lo reporta como `FUNCTION_INVOCATION_FAILED`, no como error de CORS. `normalizeIp()` collapses `::ffff:a.b.c.d` and `::1` into `127.0.0.1`, so `localhost`/`127.0.0.1` need no duplicate entries. Optional `HOST` binds the listening socket to one interface (`127.0.0.1` = this machine only); set `TRUST_PROXY` (hop count) when Nginx/ngrok/Vercel sits in front, otherwise `req.ip` is the proxy IP (y con `x-forwarded-for` presente + `trust proxy` en false, `express-rate-limit` lanza `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` → 500 en `/api/auth/login`). `CORS_ORIGIN`/`SOCKET_CORS_ORIGIN` accept a comma-separated list of **exact** origins (sin comodines) and must include every browser origin (in multi-station deployments, the IP of the machine serving the frontend). `helmet()` se configura con `crossOriginResourcePolicy: 'cross-origin'` para que `/uploads/*` cargue desde el frontend.
- No hay path alias en `tsconfig.json` (`baseUrl`/`paths` se removieron por deprecación en TS 5.x+); todos los imports son relativos. No introducir imports `@/` (ts-node-dev no los resuelve).
- tsconfig: target ES2022, module node16, strict, noUnusedLocals/Parameters, noImplicitReturns.
- **Prisma 7**: `prisma/schema.prisma` `datasource.db` has NO `url` (moved to `prisma.config.ts` `datasource.url`, loaded via `dotenv`). The Prisma Client is generated to `generated/prisma/` (gitignored) by `prisma-client` generator and MUST be imported as `../../generated/prisma/client.js` (path depth varies by file). Never import from `@prisma/client`. A `PrismaPg` driver adapter (`@prisma/adapter-pg`) is required — see `src/config/prisma.ts` and `prisma/seed.ts`. `npm run prisma:generate` compiles the generated TS to `.js`+`.d.ts` and deletes the `.ts` sources.
- **Cliente Prisma generado**: `generated/` está en `.gitignore`, así que no existe tras un clone/pull. `postinstall`, `pretypecheck` y `prebuild` ejecutan `scripts/ensure-prisma-client.cjs`, que lo regenera si falta `generated/prisma/client.d.ts`, si quedaron `.ts` sueltos o si es más antiguo que `prisma/schema.prisma` (usa un `DATABASE_URL` de relleno cuando no hay `.env`, porque `prisma.config.ts` lo exige aunque `generate` no conecte). Si falta el cliente, TypeScript emite TS2307 + cientos de errores en cascada (TS7006/TS2339/TS2538/TS18046 "is of type 'unknown'") en ~50 archivos: son síntoma, no bugs — no "arreglar" con `any`/casts. Nunca ejecutar `npx prisma generate` a secas: deja los `.ts` junto a `.js`/`.d.ts` y rompe `rootDir` con TS6059; usar siempre `npm run prisma:generate`. `npx tsc --noEmit` directo se salta los hooks, usar `npm run typecheck`.

## Architecture
- Layering: `routes/` (thin) → `controllers/` → `services/` (pure business logic, ACID) → `prisma`. Schemas in `src/schemas/`, middleware in `src/middleware/`.
- Errors: services throw `ApiError` (via `src/utils/ApiError.ts`); central handler in `src/middleware/error.ts` returns `{error, code, status}`. Preserve this shape.
- Roles hierarchy `VENDEDOR(1) < GERENTE(2) < ADMIN(3)` in `src/types/index.ts`. `requireRole('ADMIN','GERENTE')` checks max rank, so it grants GERENTE too.
- Auth: `requireAuth` (JWT Bearer) + DB blacklist check via `RevokedToken` (logout). `req.user` is `AuthedUser` with `storeId`; always scope queries to `req.user.storeId`.
- Validation: `validate(schema, 'body'|'query'|'params')` zod middleware; input data replaces `req.body`/`req.query`.
- Socket.io in `src/socket/socket.ts`; room per store (`join-store`); emits `inventory:updated`, `sale:created`, `supplier-transaction:created`.
- Redis is NOT installed despite being in `Promt_Backend.txt` spec — do not use it.
- Logging: Winston logger in `src/utils/logger.ts`.

## Data model quirks (prisma/schema.prisma)
- Money fields are `Decimal @db.Decimal(12,2)`. Always compute with `Prisma.Decimal` (do not mix with JS floats) then `Number()` at the boundary.
- Sale number is `STORE_CODE-0001`, generated by incrementing `Store.saleSequence` inside the transaction (see `sale.service.ts:generateSaleNumber`).
- Critical writes (sale, cancel sale, supplier transaction) must use `prisma.$transaction` and deduct/restore inventory atomically — validate stock via `inventory.updateMany({ where: { quantity: { gte: n } } })` and throw `INSUFFICIENT_STOCK` if `count === 0`.
- `Store.saleSequence`, `User.isActive`, `Inventory.lowStockThreshold` matter — respect them.
- **Enums**: Role (ADMIN/GERENTE/VENDEDOR), PaymentMethod (CASH/CARD/TRANSFER/CREDIT/OTHER), StoreRelation (OWNED/ASSIGNED), UnidadVenta (UNIDAD/PESO/VOLUMEN), CancellationReason (ERROR_FACTURACION, CLIENTE_PROVEEDOR_SOLICITA, DUPLICADA, DEVOLUCION_MERCANCIA, CANCELACION_PEDIDO, OTRO).
- **Models**: Store, User, RevokedToken, Category, Product (unidadVenta, costPrice, sellingPrice), Inventory (quantity Decimal(12,3), lowStockThreshold), Sale (saleNumber, total, subtotal, discount, profit, profitMargin, paymentMethod, status, cancellation fields), SaleItem (quantity Decimal(12,3), unidad, unitPrice, costPrice, profit), Supplier, SupplierTransaction, SupplierTransactionItem, AuditLog, Cliente (RFC, regimenFiscal, usoCfdi), Factura (folio, SAT fields, moneda MXN), Cancellation.

## Conventions
- All API messages/errors/logs in Spanish. Keep enum values (`Role`, `PaymentMethod`) as English uppercase constants.
- Writes that affect business state also create an `AuditLog` row (action, entity, entityId, metadata).
- Seed credentials: `admin@servicaja.com` / `admin123`, store `STORE001`.
- Dependencies: express 4.22, prisma 7.10.1, typescript 5.5, zod 4.6, socket.io 4.8, node-cron 4.6, uuid 11, bcryptjs, cors, helmet, morgan, winston, jsonwebtoken, @prisma/adapter-pg, pg.
- **Dependencias con pin/override**: `overrides.qs` fuerza `qs ^6.17.1` porque express 4.x fija `~6.15.1`/`~6.16.0` y esas versiones siguen vulnerables (DoS en `qs.parse`); no quitar el override ni "arreglarlo" bajando express. `node-cron` v4 trae sus propios tipos (`ScheduledTask` es export nombrado, ya no `cron.ScheduledTask`) y ya no depende de `uuid`: `uuid@11` se declara como dependencia directa por `src/config/multer.images.ts`. `xlsx@0.18.5` no tiene parche en npm (SheetJS abandonó el registry); alternativa evaluada: migrar a `exceljs` o instalar el tarball oficial del CDN de SheetJS.