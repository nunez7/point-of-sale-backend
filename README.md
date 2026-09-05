# ServiCaja POS

![Next.js](https://img.shields.io/badge/Next.js-15.5-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=flat-square&logo=typescript)
![React](https://img.shields.io/badge/React-19.1-61DAFB?style=flat-square&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-20+-green?style=flat-square&logo=node.js)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791?style=flat-square&logo=postgresql)
![Express](https://img.shields.io/badge/Express-4.19-000000?style=flat-square&logo=express)

Sistema integral de punto de venta (POS) diseñado para negocios de servicios financieros en Latinoamérica. Soporta múltiples tiendas, estaciones de trabajo y usuarios concurrentes con transacciones en tiempo real.

> **Dirigido a**: Tiendas de conveniencia, servicios de remesas, puntos de recaudo y negocios similares que requieren control centralizado de múltiples cajas.

---

## Tabla de Contenido

- [Características Principales](#características-principales)
- [Stack Técnico](#stack-técnico)
- [Arquitectura](#arquitectura)
- [Requisitos Previos](#requisitos-previos)
- [Instalación y Ejecución Local](#instalación-y-ejecución-local)
- [Estructura de Carpetas](#estructura-de-carpetas)
- [Scripts Disponibles](#scripts-disponibles)
- [Aviso de Privacidad](#aviso-de-privacidad)
- [Roadmap](#roadmap)
- [Licencia](#licencia)

---

## Características Principales

### Módulos del Sistema

| Módulo | Descripción |
|--------|-------------|
| **Control de Caja** | Apertura y cierre de cajas con cuadre de ventas, control de sobrantes/faltantes y movimientos de dinero con motivos configurable. |
| **Punto de Venta (POS)** | Carrito de ventas rápido con búsqueda de productos, ventas por unidad/granel, múltiples métodos de pago (efectivo, tarjeta), y generación de tickets. |
| **Inventario** | Control de stock por tienda con movimientos de entrada/salida, alertas de productos próximos a agotarse, y historial histórico de transacciones. |
| **Gestión de Productos** | Catálogo de productos con precios de costo/venta, márgenes de utilidad configurables, categorías, y gestión de presentaciones. |
| **Proveedores** | Registro de proveedores, historial de transacciones, y órdenes de compra para reabastecimiento. |
| **Facturación** | Generación de facturas electrónicas con integración CFDI, impresión de documentos fiscales. |
| **Multi-Tienda** | Administración centralizada de múltiples puntos de venta, cada uno con su propio inventario, usuarios y configuración de cajas. |
| **Reportes** | Dashboard con métricas de ventas, reportes de cortes de caja, análisis de productos más vendidos, y exportación a Excel. |
| **Promociones** | Sistema flexible de promociones: descuentos porcentuales, 2x1, combos, y promociones por período. |
| **Soporte Técnico** | Sistema interno de tickets para reportar incidencias. |

### Funcionalidades Adicionales

- **Tiempo Real**: Actualizaciones instantáneas de inventario y ventas mediante Socket.io
- **Multi-Usuario**: Sistema de roles (admin, supervisor, cajero) con autenticación JWT
- **Multi-Estación**: Cada tienda puede tener múltiples cajas/estaciones trabajando concurrentemente
- **Accesibilidad**: Atajos de teclado para operaciones rápidas en el POS
- **Responsive**: Interfaz adaptable para tablet y escritorio

---

## Stack Técnico

### Frontend

| Tecnología | Versión | Rol |
|------------|---------|-----|
| [Next.js](https://nextjs.org/) | 15.5 | Framework React con App Router y Turbopack |
| [React](https://react.dev/) | 19.1 | Librería de UI |
| [TypeScript](https://www.typescriptlang.org/) | 5.5 | Tipado estático |
| [Tailwind CSS](https://tailwindcss.com/) | 4.3 | Framework de estilos |
| [Zustand](https://zustand-demo.pmnd.rs/) | 5.0 | Estado global del cliente |
| [TanStack Query](https://tanstack.com/query/) | 5.101 | Gestión de estado del servidor |
| [Zod](https://zod.dev/) | 4.4 | Validación de esquemas |
| [Socket.io Client](https://socket.io/) | 4.8 | Comunicación en tiempo real |

### Backend

| Tecnología | Versión | Rol |
|------------|---------|-----|
| [Express.js](https://expressjs.com/) | 4.19 | Framework REST API |
| [TypeScript](https://www.typescriptlang.org/) | 5.5 | Tipado estático |
| [Prisma](https://www.prisma.io/) | 7.10 | ORM para base de datos |
| [Socket.io](https://socket.io/) | 4.7 | WebSockets para tiempo real |
| [Zod](https://zod.dev/) | 3.23 | Validación de datos |
| [JWT](https://jwt.io/) | 9.0 | Autenticación stateless |
| [Winston](https://github.com/winstonjs/winston) | 3.14 | Logging estructurado |
| [bcryptjs](https://www.npmjs.com/package/bcryptjs) | 2.4 | Hashing de contraseñas |

### Base de Datos

| Tecnología | Rol |
|-----------|-----|
| [PostgreSQL](https://www.postgresql.org/) | Base de datos relacional principal |

### Herramientas de Desarrollo

| Herramienta | Propósito |
|-------------|-----------|
| Docker Compose | _(pendiente de configurar)_ Orquestación de contenedores |
| Vitest | Testing unitario (frontend) |
| ESLint | Linting de código |
| ts-node-dev | Ejecución de TypeScript en desarrollo |

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENTES                                   │
│    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│    │   Cajero 1  │  │   Cajero 2  │  │ Supervisor  │               │
│    └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
└───────────┼────────────────┼────────────────┼───────────────────────┘
            │                │                │
            ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                          │
│                         Puerto: 3000                                │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │  App Router (React 19) + TanStack Query + Zustand        │     │
│    └──────────────────────────────────────────────────────────┘     │
│                              │ HTTP / WebSocket                      │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND (Express + Socket.io)                    │
│                         Puerto: 3001                                │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │  REST API  │  Socket.io Server  │  JWT Auth Middleware   │     │
│    └──────────────────────────────────────────────────────────┘     │
│                              │                                      │
│                              ▼                                      │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │              Prisma ORM (PostgreSQL Adapter)              │     │
│    └──────────────────────────────────────────────────────────┘     │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          BASE DE DATOS                               │
│                       PostgreSQL (Puerto 5432)                       │
│    ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│    │   Tiendas   │  │   Usuarios  │  │  Productos  │  │   Ventas   │ │
│    └────────────┘  └────────────┘  └────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Comunicación en Tiempo Real

El servidor Socket.io transmite eventos para:
- Actualización de inventario cuando se registra una venta
- Notificaciones de apertura/cierre de caja
- Alertas de productos con stock bajo
- Sincronización entre múltiples estaciones de la misma tienda

### Consideraciones de Despliegue

La arquitectura está diseñada para escalar a:
- **VPS/Cloud**: Servidor dedicado con PostgreSQL externo
- **Railway/Render**: Despliegue cloud con base de datos gestionada
- **Docker**: Contenedores independientes para frontend y backend

---

## Requisitos Previos

| Requisito | Versión Mínima | Notas |
|-----------|----------------|-------|
| Node.js | 20.x LTS | Recomendada: última versión LTS |
| npm | 10.x | Viene con Node.js |
| PostgreSQL | 16+ | También funciona con 14+ |
| Git | 2.x | Para clonar el repositorio |
| Docker | 24.x | _(opcional)_ Para despliegue en contenedores |

### Sistema Operativo

- **Windows**: PowerShell 5.1+ / WSL2 (recomendado)
- **macOS**: zsh/bash
- **Linux**: Cualquier distribución moderna

---

## Instalación y Ejecución Local

### 1. Clonar el Repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd punto-venta
```

### 2. Configurar la Base de Datos PostgreSQL

Asegúrate de tener PostgreSQL corriendo y crea una base de datos:

```sql
CREATE DATABASE "punto-venta";
CREATE USER your_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE "punto-venta" TO your_user;
```

### 3. Configurar Variables de Entorno

**Backend** (`punto-venta-backend/.env`):

```env
# Entorno
NODE_ENV=development
PORT=3001

# Base de datos PostgreSQL
DATABASE_URL="postgresql://user:password@localhost:5432/punto-venta?schema=public"

# Autenticación JWT
JWT_SECRET="genera-una-clave-secreta-muy-larga-y-aleatoria"
JWT_EXPIRES_IN=8h

# CORS (en desarrollo: *, en producción: URL del frontend)
CORS_ORIGIN="*"
SOCKET_CORS_ORIGIN="*"

# Pool de conexiones
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000
```

**Frontend** (`punto-venta-frontend/.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 4. Instalar Dependencias

```bash
# Backend
cd punto-venta-backend
npm install

# Frontend
cd ../punto-venta-frontend
npm install
```

### 5. Ejecutar Migraciones de Prisma

```bash
cd punto-venta-backend
npm run prisma:generate
npm run prisma:migrate
```

### 6. Poblar Datos de Prueba (Seed)

```bash
npm run prisma:seed
```

> **Credenciales de prueba**: `admin@servicaja.com` / `admin123`

### 7. Iniciar los Servidores

```bash
# Terminal 1: Backend
cd punto-venta-backend
npm run dev

# Terminal 2: Frontend
cd punto-venta-frontend
npm run dev
```

### 8. Acceder a la Aplicación

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| API Docs | _(pendiente)_ |

---

## Estructura de Carpetas

```
punto-venta/
├── AGENTS.md                    # Documentación interna del proyecto
├── Promt_Backend.txt           # Especificación original del backend
├── Promt_Front.txt            # Especificación original del frontend
│
├── punto-venta-backend/        # ─── API REST (Node.js + Express)
│   ├── prisma/
│   │   ├── schema.prisma      # Definición del modelo de datos
│   │   ├── seed.ts            # Datos iniciales de prueba
│   │   └── migrations/       # Historial de migraciones
│   ├── src/
│   │   ├── server.ts          # Punto de entrada
│   │   ├── app.ts             # Configuración de Express
│   │   ├── config/            # Configuración centralizada
│   │   ├── middleware/        # Auth, validación, errores
│   │   ├── routes/            # 17 archivos de rutas API
│   │   ├── controllers/       # Lógica de controladores
│   │   ├── services/          # Lógica de negocio
│   │   ├── schemas/           # Esquemas Zod para validación
│   │   ├── socket/            # Configuración Socket.io
│   │   ├── utils/             # Utilidades compartidas
│   │   └── types/             # Tipos TypeScript
│   └── package.json
│
└── punto-venta-frontend/      # ─── Aplicación Web (Next.js)
    ├── public/                 # Archivos estáticos
    ├── src/
    │   ├── app/               # Next.js App Router
    │   │   ├── (app)/         # Rutas autenticadas (dashboard, POS, etc.)
    │   │   ├── (auth)/        # Rutas públicas (login)
    │   │   └── page.tsx       # Landing page
    │   ├── components/        # Componentes React
    │   │   ├── ui/            # Componentes base (shadcn/ui)
    │   │   ├── dashboard/     # Widgets del dashboard
    │   │   ├── cajas/         # Componentes de gestión de cajas
    │   │   └── reportes/      # Componentes de reportes
    │   ├── hooks/             # Custom hooks (30+)
    │   ├── stores/            # Stores Zustand
    │   ├── lib/               # Utilidades y cliente API
    │   └── types/             # Tipos TypeScript
    └── package.json
```

---

## Scripts Disponibles

### Backend (`punto-venta-backend/`)

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Inicia servidor de desarrollo con hot-reload |
| `npm run build` | Compila TypeScript a JavaScript en `dist/` |
| `npm start` | Inicia servidor en producción |
| `npm run typecheck` | Verifica tipos TypeScript |
| `npm run prisma:generate` | Genera cliente Prisma desde schema |
| `npm run prisma:migrate` | Crea/aplica migraciones (desarrollo) |
| `npm run prisma:deploy` | Aplica migraciones (producción) |
| `npm run prisma:studio` | Abre GUI de Prisma en el navegador |
| `npm run prisma:seed` | Inserta datos de prueba |

### Frontend (`punto-venta-frontend/`)

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Inicia servidor de desarrollo (Turbopack) |
| `npm run build` | Genera build de producción |
| `npm start` | Inicia servidor de producción |
| `npm run lint` | Ejecuta ESLint |
| `npm test` | Ejecuta tests con Vitest |
| `npm run test:ui` | Ejecuta tests con interfaz visual |
| `npm run test:coverage` | Ejecuta tests con cobertura |

---

## Aviso de Privacidad

Este sistema maneja datos personales de usuarios, clientes, proveedores y transacciones comerciales. Consulta nuestro [Aviso de Privacidad](./punto-venta-frontend/src/app/aviso-privacidad/page.tsx) para conocer cómo protegemos tu información.

---

## Roadmap

- [ ] Configuración de Docker Compose para despliegue local
- [ ] Integración con servicios de facturación electrónica (DIAN/CFDI)
- [ ] API de OpenAPI/Swagger
- [ ] Aplicación móvil nativa (React Native)
- [ ] Módulo de reportes avanzados con gráficos
- [ ] Integración con impresoras fiscales
- [ ] Sistema de inventario con código de barras/QR
- [ ] Reporte de ventas por método de pago
- [ ] Dashboard ejecutivo con KPIs en tiempo real
- [ ] Módulo de gestión de créditos y cartera

---

## Licencia

[Placeholder: Indica la licencia del proyecto]

---

## Contacto y Soporte

- **Email**: [felixjavier0@gmail.com](mailto:felixjavier0@gmail.com)
- **Issues**: [https://github.com/usuario/servicaja/issues](https://github.com/usuario/servicaja/issues)

---

*Última actualización: 2026-09-05*
