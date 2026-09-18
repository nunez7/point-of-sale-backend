# ServiCaja POS — Backend

![Express](https://img.shields.io/badge/Express-4.19-000000?style=flat-square&logo=express)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=flat-square&logo=typescript)
![Prisma](https://img.shields.io/badge/Prisma-7.10-2D3748?style=flat-square&logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791?style=flat-square&logo=postgresql)
![Socket.io](https://img.shields.io/badge/Socket.io-4.7-010101?style=flat-square&logo=socket.io)

API REST del sistema POS ServiCaja. Express + TypeScript + Prisma + PostgreSQL + Socket.io.

---

## Tabla de Contenido

- [Stack](#stack)
- [Requisitos Previos](#requisitos-previos)
- [Instalación](#instalación)
- [Scripts](#scripts)
- [Arquitectura](#arquitectura)
- [Modelo de Datos](#modelo-de-datos)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Stack

| Tecnología | Versión | Rol |
|------------|---------|-----|
| [Express.js](https://expressjs.com/) | 4.19 | Framework REST API |
| [TypeScript](https://www.typescriptlang.org/) | 5.5 | Tipado estático |
| [Prisma](https://www.prisma.io/) | 7.10 | ORM para PostgreSQL |
| [Socket.io](https://socket.io/) | 4.7 | WebSockets para tiempo real |
| [Zod](https://zod.dev/) | 4.5 | Validación de datos |
| [JWT](https://jwt.io/) | 9.0 | Autenticación stateless |
| [Winston](https://github.com/winstonjs/winston) | 3.14 | Logging estructurado |
| [bcryptjs](https://www.npmjs.com/package/bcryptjs) | 2.4 | Hashing de contraseñas |

---

## Requisitos Previos

| Requisito | Versión |
|-----------|---------|
| Node.js | 20.x LTS |
| npm | 10.x |
| PostgreSQL | 16+ (también funciona con 14+) |

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de entorno
cp .env.example .env
# Editar .env con tus datos de PostgreSQL y un JWT_SECRET seguro
```

### Variables de Entorno

```env
NODE_ENV=development
PORT=3001
DATABASE_URL="postgresql://user:password@localhost:5432/punto-venta?schema=public"
JWT_SECRET="clave-secreta-larga-y-aleatoria"
JWT_EXPIRES_IN=8h
CORS_ORIGIN="*"
SOCKET_CORS_ORIGIN="*"
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000
```

> **Puerto**: El backend debe correr en **3001**. El frontend espera esta conexión en `NEXT_PUBLIC_API_URL=http://localhost:3001`.

### Base de Datos

```sql
CREATE DATABASE "punto-venta";
CREATE USER your_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE "punto-venta" TO your_user;
```

### Migraciones y Seed

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

> Credenciales de prueba: `admin@servicaja.com` / `admin123`

---

## Scripts

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Inicia servidor con hot-reload (`ts-node-dev --transpile-only`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Inicia servidor en producción |
| `npm run typecheck` | Verifica tipos TypeScript |
| `npm run prisma:generate` | Genera cliente Prisma desde schema |
| `npm run prisma:migrate` | Crea/aplica migraciones (desarrollo) |
| `npm run prisma:deploy` | Aplica migraciones (producción) |
| `npm run prisma:studio` | Abre GUI de Prisma en el navegador |
| `npm run prisma:seed` | Inserta datos de prueba |

> `ts-node-dev --transpile-only` **omite** la verificación de tipos durante desarrollo. Ejecutar `npm run typecheck` periódicamente.

---

## Arquitectura

### Estructura

```
src/
├── server.ts           # Punto de entrada
├── app.ts              # Configuración de Express
├── config/             # Configuración centralizada (env, prisma)
├── middleware/         # Auth, validación, errores
├── routes/             # Rutas API (17 archivos)
├── controllers/        # Lógica de controladores
├── services/           # Lógica de negocio (ACID)
├── schemas/            # Esquemas Zod para validación
├── socket/             # Configuración Socket.io
├── utils/              # Utilidades compartidas (ApiError, logger)
├── types/              # Tipos TypeScript
└── prisma/
    ├── schema.prisma   # Definición del modelo de datos
    ├── prisma.config.ts # URL de BD (Prisma 7)
    ├── seed.ts         # Datos iniciales
    └── migrations/     # Historial de migraciones
```

### Capas

```
routes/ (thin) → controllers/ → services/ (pure business logic, ACID) → prisma
```

### Convenciones

- **Mensajes/errores/logs**: Siempre en **español**.
- **Enum values**: En **inglés** mayúsculas (`Role.ADMIN`, `PaymentMethod.CASH`).
- **AuditLog**: Las escrituras que afectan estado del negocio crean un `AuditLog`.
- **Errores**: Services lanzan `ApiError` (via `src/utils/ApiError.ts`). Handler centralizado en `src/middleware/error.ts`.
- **Roles**: `VENDEDOR(1) < GERENTE(2) < ADMIN(3)`. `requireRole('ADMIN','GERENTE')`检查最大排名。
- **Auth**: `requireAuth` (JWT Bearer) + blacklist check via `RevokedToken`. `req.user` tiene `storeId`.
- **Validation**: `validate(schema, 'body'|'query'|'params')` — zod middleware que reemplaza `req.body`.
- **Imports**: Todos relativos (no hay path alias). No usar `@/`.

### Socket.io

Eventos transmitidos:
- `inventory:updated` — actualización de inventario por venta
- `sale:created` — nueva venta registrada
- `supplier-transaction:created` — transacción con proveedor
- Room por tienda (`join-store`)

---

## Modelo de Datos

### Datos monetarios

Los campos de dinero usan `Decimal @db.Decimal(12,2)`. Calcular siempre con `Prisma.Decimal` y usar `Number()` solo al final.

### Ventas

- Número de venta: `STORE_CODE-0001` (generado incrementando `Store.saleSequence` en la transacción)
- Escrituras críticas (venta, cancelación, transacción de proveedor) usan `prisma.$transaction` con deducción/reestablecimiento atómico de inventario
- Stock se valida con `inventory.updateMany({ where: { quantity: { gte: n } } })` — si `count === 0`, lanzar `INSUFFICIENT_STOCK`

### Enums

- `Role`: `ADMIN`, `GERENTE`, `VENDEDOR`
- `PaymentMethod`: `CASH`, `CARD`, `TRANSFER`, `CREDIT`, `OTHER`
- `UnidadVenta`: `UNIDAD`, `PESO`, `VOLUMEN`
- `CancellationReason`: `ERROR_FACTURACION`, `CLIENTE_PROVEEDOR_SOLICITA`, `DUPLICADA`, `DEVOLUCION_MERCANCIA`, `CANCELACION_PEDIDO`, `OTRO`

### Modelos principales

Store, User, RevokedToken, Category, Product, Inventory, Sale, SaleItem, Supplier, SupplierTransaction, SupplierTransactionItem, AuditLog, Cliente, Factura, Cancellation.

---

## Troubleshooting

### PostgreSQL no conecta

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

1. Verificar que PostgreSQL está activo: `pg_isready`
2. Revisar `DATABASE_URL` en `.env` — debe incluir `?schema=public`
3. Verificar que la BD existe: `psql -U postgres -c "\l"`

---

### Puerto 3001 ocupado

```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:3001 | xargs kill -9
```

---

### Migraciones de Prisma fallan

```
Error: P1001: Can't reach database server
```

1. PostgreSQL corriendo
2. Ejecutar `npm run prisma:generate` antes de `npm run prisma:migrate`
3. **Prisma 7**: El `url` está en `prisma.config.ts`, no en `schema.prisma`

---

### Import de Prisma falla

```
Cannot find module '../../generated/prisma/client.js'
```

```bash
npm run prisma:generate
```

> **Prisma 7**: Nunca importar desde `@prisma/client`. Siempre usar `../../generated/prisma/client.js`.

---

### Seed no ejecuta

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

---

### Errores de TypeScript

```bash
npm run typecheck
```

El backend tiene `noUnusedLocals` y `noUnusedParameters` activados — código no utilizado causará errores.

---

### Dev server no muestra errores de tipo

`ts-node-dev --transpile-only` omite verificación de tipos. Ejecutar `npm run typecheck` para detectar errores.

---

## Contributing

El backend no tiene repositorio git propio. Los cambios se realizan directamente en la carpeta `punto-venta-backend/`.

**Convenciones**:
- Todos los mensajes, errores y logs en **español**.
- Los valores de enum se mantienen en **inglés mayúsculas**.
- Las escrituras que afectan el estado del negocio deben crear un `AuditLog`.
- Los campos de dinero usan `Decimal @db.Decimal(12,2)` — calcular con `Prisma.Decimal` y usar `Number()` solo al final.
- Las migraciones se crean con `npm run prisma:migrate -- --name <nombre>`.
- Ejecutar `npm run typecheck` antes de entregar cambios.
