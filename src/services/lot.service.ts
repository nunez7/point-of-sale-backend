import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';

// ───────────────────────────────────────────────────────────────────────────
// Lotes de mercancía (rotación FEFO: primero lo que caduca antes).
//
// Invariante que mantiene este módulo: para cada producto,
//   Inventory.quantity == SUMA(InventoryLot.availableQty)
// sin importar el `status` del lote. `status` es solo una etiqueta informativa
// (ACTIVE con saldo, DEPLETED agotado por ventas, EXPIRED caducado,
// DISCARDED merma); el saldo real es siempre `availableQty`.
//
// Todo lo que toca inventario pasa por aquí dentro de la misma transacción
// del llamador, para que el total y los lotes nunca se desfasen.
// ───────────────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;
type DecimalLike = Prisma.Decimal | number | string;

export const LOTE_AJUSTE_CODE = 'AJUSTE';

export function aDecimal(valor: DecimalLike | null | undefined): Prisma.Decimal {
  if (valor === null || valor === undefined) return new Prisma.Decimal(0);
  return valor instanceof Prisma.Decimal ? valor : new Prisma.Decimal(valor.toString());
}

// Las caducidades son fechas sin hora. Se normalizan a medianoche UTC y se
// comparan por día, de modo que "vence hoy" siga siendo vendible hasta el
// final del día sin importar la zona horaria del servidor.
export function inicioDiaUTC(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

export function parsearFechaCaducidad(valor?: string | Date | null): Date | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : inicioDiaUTC(valor);
  }
  const texto = String(valor).trim();
  if (!texto) return null;

  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (soloFecha) {
    const anio = Number(soloFecha[1]);
    const mes = Number(soloFecha[2]);
    const dia = Number(soloFecha[3]);
    return new Date(Date.UTC(anio, mes - 1, dia));
  }

  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : inicioDiaUTC(fecha);
}

// Días que faltan para caducar (negativo = ya caducó). null = sin caducidad.
export function diasParaVencer(expirationDate: Date | null, hoy: Date = new Date()): number | null {
  if (!expirationDate) return null;
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  return Math.round((inicioDiaUTC(expirationDate).getTime() - inicioDiaUTC(hoy).getTime()) / MS_POR_DIA);
}

export type EstadoVencimiento = 'SIN_CADUCIDAD' | 'VIGENTE' | 'POR_VENCER' | 'CADUCADO';

export function estadoVencimiento(expirationDate: Date | null, hoy: Date = new Date(), diasAviso = 7): EstadoVencimiento {
  const dias = diasParaVencer(expirationDate, hoy);
  if (dias === null) return 'SIN_CADUCIDAD';
  if (dias < 0) return 'CADUCADO';
  if (dias <= diasAviso) return 'POR_VENCER';
  return 'VIGENTE';
}

// ───────────────────────────────────────────────────────────────────────────
// Alta de lotes
// ───────────────────────────────────────────────────────────────────────────

export interface NuevoLoteInput {
  storeId: string;
  productId: string;
  quantity: DecimalLike;
  unitCost: DecimalLike;
  expirationDate?: string | Date | null;
  lotCode?: string | null;
  supplierTransactionItemId?: string | null;
}

export async function crearLote(tx: Tx, input: NuevoLoteInput) {
  const cantidad = aDecimal(input.quantity);
  if (cantidad.lte(0)) {
    throw ApiError.badRequest(
      'La cantidad del lote debe ser mayor a 0',
      'INVALID_LOT_QUANTITY'
    );
  }

  return tx.inventoryLot.create({
    data: {
      storeId: input.storeId,
      productId: input.productId,
      lotCode: input.lotCode?.trim() ? input.lotCode.trim() : null,
      expirationDate: parsearFechaCaducidad(input.expirationDate),
      receivedQty: cantidad,
      availableQty: cantidad,
      unitCost: aDecimal(input.unitCost),
      supplierTransactionItemId: input.supplierTransactionItemId ?? null,
      status: 'ACTIVE',
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Consumo FEFO
// ───────────────────────────────────────────────────────────────────────────

export interface ItemAConsumir {
  productId: string;
  quantity: DecimalLike;
  /** Solo para el mensaje de error. */
  name?: string;
}

export interface AsignacionLote {
  lotId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  expirationDate: Date | null;
  lotCode: string | null;
}

interface LoteDisponible {
  id: string;
  expirationDate: Date | null;
  lotCode: string | null;
  unitCost: Prisma.Decimal;
  disponible: Prisma.Decimal;
}

// Calcula de qué lotes sale cada ítem, sin escribir nada. El orden es FEFO:
// caducidad más próxima primero y los lotes sin caducidad al final. Soporta
// varias líneas del mismo producto descontando de un saldo en memoria.
export async function planearConsumoFEFO(
  tx: Tx,
  storeId: string,
  items: ItemAConsumir[]
): Promise<AsignacionLote[][]> {
  if (items.length === 0) return [];

  const productIds = Array.from(new Set(items.map((i) => i.productId)));

  const [inventarios, lotes] = await Promise.all([
    tx.inventory.findMany({
      where: { storeId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    }),
    tx.inventoryLot.findMany({
      where: { storeId, productId: { in: productIds }, availableQty: { gt: 0 } },
      orderBy: [
        { expirationDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    }),
  ]);

  const disponiblesPorProducto = new Map<string, LoteDisponible[]>();
  for (const lote of lotes) {
    const lista = disponiblesPorProducto.get(lote.productId) ?? [];
    lista.push({
      id: lote.id,
      expirationDate: lote.expirationDate,
      lotCode: lote.lotCode,
      unitCost: new Prisma.Decimal(lote.unitCost.toString()),
      disponible: new Prisma.Decimal(lote.availableQty.toString()),
    });
    disponiblesPorProducto.set(lote.productId, lista);
  }

  // Autocorrección: si el inventario tiene saldo que ningún lote respalda
  // (datos previos a la migración, o una ruta que incrementó el total sin
  // crear lote), se crea un lote de ajuste sin caducidad para no bloquear la
  // operación. Queda auditado para poder revisarlo después.
  const inventarioPorProducto = new Map(
    inventarios.map((i) => [i.productId, new Prisma.Decimal(i.quantity.toString())])
  );
  for (const productId of productIds) {
    const totalLotes = (disponiblesPorProducto.get(productId) ?? []).reduce(
      (acc, lote) => acc.plus(lote.disponible),
      new Prisma.Decimal(0)
    );
    const totalInventario = inventarioPorProducto.get(productId) ?? new Prisma.Decimal(0);
    if (totalInventario.lte(totalLotes)) continue;

    const diferencia = totalInventario.minus(totalLotes);
    const producto = await tx.product.findUnique({
      where: { id: productId },
      select: { name: true, costPrice: true },
    });
    const lote = await crearLote(tx, {
      storeId,
      productId,
      quantity: diferencia,
      unitCost: producto?.costPrice ?? new Prisma.Decimal(0),
      expirationDate: null,
      lotCode: LOTE_AJUSTE_CODE,
    });

    const lista = disponiblesPorProducto.get(productId) ?? [];
    lista.push({
      id: lote.id,
      expirationDate: null,
      lotCode: lote.lotCode,
      unitCost: new Prisma.Decimal(lote.unitCost.toString()),
      disponible: new Prisma.Decimal(lote.availableQty.toString()),
    });
    disponiblesPorProducto.set(productId, lista);

    await tx.auditLog.create({
      data: {
        storeId,
        action: 'LOTE_AJUSTE',
        entity: 'InventoryLot',
        entityId: lote.id,
        metadata: {
          productId,
          productName: producto?.name ?? null,
          quantity: Number(diferencia),
          motivo: 'Inventario sin lote que lo respalde; se creó un lote de ajuste',
        },
      },
    });
  }

  const planes: AsignacionLote[][] = [];
  for (const item of items) {
    const requerido = aDecimal(item.quantity);
    const disponibles = disponiblesPorProducto.get(item.productId) ?? [];
    const asignaciones: AsignacionLote[] = [];
    let restante = requerido;

    for (const lote of disponibles) {
      if (restante.lte(0)) break;
      if (lote.disponible.lte(0)) continue;
      const tomar = restante.lt(lote.disponible) ? restante : lote.disponible;
      asignaciones.push({
        lotId: lote.id,
        quantity: tomar,
        unitCost: lote.unitCost,
        expirationDate: lote.expirationDate,
        lotCode: lote.lotCode,
      });
      restante = restante.minus(tomar);
      lote.disponible = lote.disponible.minus(tomar);
    }

    if (restante.gt(0)) {
      const etiqueta = item.name ?? item.productId;
      throw ApiError.badRequest(
        `Stock insuficiente para "${etiqueta}" (faltan ${Number(restante)})`,
        'INSUFFICIENT_STOCK'
      );
    }

    planes.push(asignaciones);
  }

  return planes;
}

// Costo unitario promedio ponderado de los lotes que surtieron la línea.
export function costoPromedioPonderado(asignaciones: AsignacionLote[]): Prisma.Decimal {
  let cantidad = new Prisma.Decimal(0);
  let costo = new Prisma.Decimal(0);
  for (const asignacion of asignaciones) {
    cantidad = cantidad.plus(asignacion.quantity);
    costo = costo.plus(asignacion.quantity.mul(asignacion.unitCost));
  }
  if (cantidad.lte(0)) return new Prisma.Decimal(0);
  return costo.div(cantidad).toDecimalPlaces(2);
}

// Costo total (cantidad * costo de cada lote sumado). Base para el margen real.
export function costoTotalAsignado(asignaciones: AsignacionLote[]): Prisma.Decimal {
  return asignaciones.reduce(
    (acc, asignacion) => acc.plus(asignacion.quantity.mul(asignacion.unitCost)),
    new Prisma.Decimal(0)
  );
}

// Descuenta los lotes asignados y deja la trazabilidad en SaleItemLot.
// La condición `availableQty >= cantidad` es el candado contra dos cajas
// vendiendo el mismo último lote a la vez.
export async function aplicarConsumo(
  tx: Tx,
  saleItemId: string,
  asignaciones: AsignacionLote[]
): Promise<void> {
  for (const asignacion of asignaciones) {
    if (asignacion.quantity.lte(0)) continue;

    const actualizado = await tx.inventoryLot.updateMany({
      where: { id: asignacion.lotId, availableQty: { gte: asignacion.quantity } },
      data: { availableQty: { decrement: asignacion.quantity } },
    });
    if (actualizado.count === 0) {
      throw ApiError.badRequest(
        'El inventario cambió mientras se registraba la operación. Vuelve a intentarlo.',
        'INSUFFICIENT_STOCK'
      );
    }

    await tx.saleItemLot.create({
      data: {
        saleItemId,
        lotId: asignacion.lotId,
        quantity: asignacion.quantity,
        unitCost: asignacion.unitCost,
      },
    });

    await tx.inventoryLot.updateMany({
      where: { id: asignacion.lotId, availableQty: { lte: 0 } },
      data: { status: 'DEPLETED' },
    });
  }
}

// Igual que aplicarConsumo pero sin SaleItemLot: para salidas que no son
// ventas (merma, caducados, ajustes negativos).
export async function consumirLotesDeProducto(
  tx: Tx,
  storeId: string,
  productId: string,
  quantity: DecimalLike,
  name?: string
): Promise<AsignacionLote[]> {
  const [asignaciones] = await planearConsumoFEFO(tx, storeId, [
    { productId, quantity, name },
  ]);

  for (const asignacion of asignaciones) {
    const actualizado = await tx.inventoryLot.updateMany({
      where: { id: asignacion.lotId, availableQty: { gte: asignacion.quantity } },
      data: { availableQty: { decrement: asignacion.quantity } },
    });
    if (actualizado.count === 0) {
      throw ApiError.badRequest(
        'El inventario cambió mientras se registraba la operación. Vuelve a intentarlo.',
        'INSUFFICIENT_STOCK'
      );
    }
    await tx.inventoryLot.updateMany({
      where: { id: asignacion.lotId, availableQty: { lte: 0 } },
      data: { status: 'DEPLETED' },
    });
  }

  return asignaciones;
}

// Alinea la suma de lotes con un total de inventario dado (importaciones y
// ajustes masivos donde el stock se fija, no se suma). Crea un lote genérico
// si falta respaldo o descuenta por FEFO si sobra.
export async function ajustarLotesAInventario(
  tx: Tx,
  storeId: string,
  productId: string,
  targetQuantity: DecimalLike,
  unitCost?: DecimalLike,
  expirationDate?: string | Date | null
): Promise<void> {
  const objetivo = aDecimal(targetQuantity);
  const lotes = await tx.inventoryLot.findMany({
    where: { storeId, productId },
    select: { availableQty: true },
  });
  const totalLotes = lotes.reduce(
    (acc, lote) => acc.plus(new Prisma.Decimal(lote.availableQty.toString())),
    new Prisma.Decimal(0)
  );

  const diferencia = objetivo.minus(totalLotes);
  if (diferencia.gt(0)) {
    const producto = await tx.product.findUnique({
      where: { id: productId },
      select: { costPrice: true },
    });
    await crearLote(tx, {
      storeId,
      productId,
      quantity: diferencia,
      unitCost: unitCost ?? producto?.costPrice ?? new Prisma.Decimal(0),
      expirationDate: expirationDate ?? null,
      lotCode: LOTE_AJUSTE_CODE,
    });
  } else if (diferencia.lt(0)) {
    await consumirLotesDeProducto(tx, storeId, productId, diferencia.abs());
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Reversas (cancelaciones y devoluciones)
// ───────────────────────────────────────────────────────────────────────────

export interface RestauracionLote {
  lotId: string;
  quantity: DecimalLike;
}

// Devuelve cantidades a sus lotes originales. Si algún lote ya no existe se
// reporta el residuo para que el llamador lo coloque en un lote genérico.
export async function restaurarLotes(
  tx: Tx,
  restauraciones: RestauracionLote[]
): Promise<void> {
  for (const restauracion of restauraciones) {
    const cantidad = aDecimal(restauracion.quantity);
    if (cantidad.lte(0)) continue;
    await tx.inventoryLot.updateMany({
      where: { id: restauracion.lotId },
      data: { availableQty: { increment: cantidad }, status: 'ACTIVE' },
    });
  }
}

export interface AsignacionPersistida {
  id: string;
  lotId: string;
  quantity: Prisma.Decimal;
  restoredQty: Prisma.Decimal;
}

// Devuelve hasta `cantidad` a los lotes de una línea de venta respetando lo
// que ya se hubiera devuelto antes (cancelaciones parciales repetidas). Es la
// reversa exacta del consumo: nunca regresa más de lo que salió del lote.
export async function restaurarDeAsignaciones(
  tx: Tx,
  asignaciones: AsignacionPersistida[],
  cantidad: DecimalLike
): Promise<Prisma.Decimal> {
  let restante = aDecimal(cantidad);

  for (const asignacion of asignaciones) {
    if (restante.lte(0)) break;

    const consumido = new Prisma.Decimal(asignacion.quantity.toString());
    const devuelto = new Prisma.Decimal(asignacion.restoredQty.toString());
    const pendiente = consumido.minus(devuelto);
    if (pendiente.lte(0)) continue;

    const devolver = restante.lt(pendiente) ? restante : pendiente;
    await tx.inventoryLot.updateMany({
      where: { id: asignacion.lotId },
      data: { availableQty: { increment: devolver }, status: 'ACTIVE' },
    });
    await tx.saleItemLot.update({
      where: { id: asignacion.id },
      data: { restoredQty: { increment: devolver } },
    });
    restante = restante.minus(devolver);
  }

  return restante;
}

// Coloca una devolución en el lote más reciente del producto o, si no hay
// ninguno, crea un lote genérico sin caducidad. Se usa para ventas anteriores
// a la migración, que no tienen SaleItemLot.
export async function restaurarLoteGenerico(
  tx: Tx,
  storeId: string,
  productId: string,
  quantity: DecimalLike,
  unitCost?: DecimalLike
): Promise<void> {
  const cantidad = aDecimal(quantity);
  if (cantidad.lte(0)) return;

  const lote = await tx.inventoryLot.findFirst({
    where: { storeId, productId },
    orderBy: { createdAt: 'desc' },
  });
  if (lote) {
    await tx.inventoryLot.update({
      where: { id: lote.id },
      data: { availableQty: { increment: cantidad }, status: 'ACTIVE' },
    });
    return;
  }

  const producto = await tx.product.findUnique({
    where: { id: productId },
    select: { costPrice: true },
  });
  await crearLote(tx, {
    storeId,
    productId,
    quantity: cantidad,
    unitCost: unitCost ?? producto?.costPrice ?? new Prisma.Decimal(0),
    expirationDate: null,
    lotCode: 'DEVOLUCION',
  });
}

// Retira de los lotes de una compra cancelada. Devuelve la cantidad que no se
// pudo retirar porque ya se había vendido.
export async function retirarLotesDeCompra(
  tx: Tx,
  compraItemId: string,
  quantity: DecimalLike
): Promise<Prisma.Decimal> {
  let restante = aDecimal(quantity);
  if (restante.lte(0)) return new Prisma.Decimal(0);

  const lotes = await tx.inventoryLot.findMany({
    where: { supplierTransactionItemId: compraItemId, availableQty: { gt: 0 } },
    orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });

  for (const lote of lotes) {
    if (restante.lte(0)) break;
    const disponible = new Prisma.Decimal(lote.availableQty.toString());
    if (disponible.lte(0)) continue;
    const retirar = restante.lt(disponible) ? restante : disponible;
    await tx.inventoryLot.update({
      where: { id: lote.id },
      data: {
        availableQty: { decrement: retirar },
        ...(retirar.gte(disponible) && { status: 'DEPLETED' }),
      },
    });
    restante = restante.minus(retirar);
  }

  return restante;
}

// ───────────────────────────────────────────────────────────────────────────
// Consultas
// ───────────────────────────────────────────────────────────────────────────

export interface LoteSerializado {
  id: string;
  productId: string;
  productName: string | null;
  sku: string | null;
  unidadVenta: string | null;
  lotCode: string | null;
  expirationDate: string | null;
  diasParaVencer: number | null;
  estado: EstadoVencimiento;
  receivedQty: number;
  availableQty: number;
  unitCost: number;
  valorDisponible: number;
  status: string;
  supplierTransactionItemId: string | null;
  createdAt: string;
}

interface LoteConProducto {
  id: string;
  productId: string;
  lotCode: string | null;
  expirationDate: Date | null;
  receivedQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  status: string;
  supplierTransactionItemId: string | null;
  createdAt: Date;
  product?: {
    name: string;
    sku: string | null;
    unidadVenta: string;
  } | null;
}

export function serializarLote(lote: LoteConProducto, diasAviso = 7): LoteSerializado {
  const disponible = new Prisma.Decimal(lote.availableQty.toString());
  const costo = new Prisma.Decimal(lote.unitCost.toString());
  return {
    id: lote.id,
    productId: lote.productId,
    productName: lote.product?.name ?? null,
    sku: lote.product?.sku ?? null,
    unidadVenta: lote.product?.unidadVenta ?? null,
    lotCode: lote.lotCode,
    expirationDate: lote.expirationDate ? lote.expirationDate.toISOString().slice(0, 10) : null,
    diasParaVencer: diasParaVencer(lote.expirationDate),
    estado: estadoVencimiento(lote.expirationDate, new Date(), diasAviso),
    receivedQty: Number(lote.receivedQty),
    availableQty: Number(disponible),
    unitCost: Number(costo),
    valorDisponible: Number(costo.mul(disponible).toDecimalPlaces(2)),
    status: lote.status,
    supplierTransactionItemId: lote.supplierTransactionItemId,
    createdAt: lote.createdAt.toISOString(),
  };
}

export interface LoteFiltros {
  productId?: string;
  search?: string;
  /** Solo lotes con saldo disponible. */
  conSaldo?: boolean;
  /** Dias de anticipacion para marcar "por vencer". */
  diasAviso?: number;
  /** Filtra por estado de vencimiento. */
  vencimiento?: 'TODOS' | 'POR_VENCER' | 'CADUCADO' | 'SIN_CADUCIDAD';
  /** Solo lotes que vencen dentro de N dias (incluye caducados). */
  venceEnDias?: number;
  page?: number;
  limit?: number;
}

export async function listarLotes(storeId: string, filtros: LoteFiltros = {}) {
  const diasAviso = filtros.diasAviso ?? 7;
  const where: Prisma.InventoryLotWhereInput = { storeId };

  if (filtros.productId) where.productId = filtros.productId;
  if (filtros.conSaldo) where.availableQty = { gt: 0 };
  if (filtros.search) {
    where.product = { name: { contains: filtros.search, mode: 'insensitive' } };
  }

  const hoy = inicioDiaUTC(new Date());
  if (filtros.venceEnDias !== undefined) {
    const limite = new Date(hoy.getTime() + filtros.venceEnDias * 24 * 60 * 60 * 1000);
    where.expirationDate = { not: null, lte: limite };
  }
  if (filtros.vencimiento === 'CADUCADO') {
    where.expirationDate = { not: null, lt: hoy };
  } else if (filtros.vencimiento === 'POR_VENCER') {
    const limite = new Date(hoy.getTime() + diasAviso * 24 * 60 * 60 * 1000);
    where.expirationDate = { not: null, gte: hoy, lte: limite };
  } else if (filtros.vencimiento === 'SIN_CADUCIDAD') {
    where.expirationDate = null;
  }

  const orderBy: Prisma.InventoryLotOrderByWithRelationInput[] = [
    { expirationDate: { sort: 'asc', nulls: 'last' } },
    { createdAt: 'asc' },
  ];

  const include = {
    product: { select: { name: true, sku: true, unidadVenta: true } },
  } as const;

  if (!filtros.page) {
    const lotes = await prisma.inventoryLot.findMany({ where, include, orderBy });
    return { lots: lotes.map((l) => serializarLote(l, diasAviso)) };
  }

  const limit = filtros.limit ?? 50;
  const [lotes, total] = await prisma.$transaction([
    prisma.inventoryLot.findMany({
      where,
      include,
      orderBy,
      skip: (filtros.page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryLot.count({ where }),
  ]);

  return {
    lots: lotes.map((l) => serializarLote(l, diasAviso)),
    total,
    page: filtros.page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// Lotes con saldo que caducan dentro de `dias` o que ya caducaron.
export async function lotesPorVencer(storeId: string, dias = 7) {
  const hoy = inicioDiaUTC(new Date());
  const limite = new Date(hoy.getTime() + dias * 24 * 60 * 60 * 1000);

  const lotes = await prisma.inventoryLot.findMany({
    where: {
      storeId,
      availableQty: { gt: 0 },
      expirationDate: { not: null, lte: limite },
    },
    include: { product: { select: { name: true, sku: true, unidadVenta: true } } },
    orderBy: [{ expirationDate: 'asc' }, { createdAt: 'asc' }],
  });

  const serializados = lotes.map((l) => serializarLote(l, dias));
  return {
    dias,
    lots: serializados,
    caducados: serializados.filter((l) => l.estado === 'CADUCADO'),
    porVencer: serializados.filter((l) => l.estado === 'POR_VENCER'),
    valorEnRiesgo: serializados.reduce((acc, l) => acc + l.valorDisponible, 0),
  };
}

// Diagnóstico: productos donde el total del inventario no coincide con la
// suma de sus lotes. Debe devolver siempre una lista vacía.
export async function verificarCuadre(storeId: string) {
  const filas = await prisma.$queryRaw<
    Array<{
      productId: string;
      productName: string;
      inventario: string;
      lotes: string;
      diferencia: string;
    }>
  >`
    SELECT i."productId"                                   AS "productId",
           p."name"                                        AS "productName",
           i."quantity"::text                              AS inventario,
           COALESCE(SUM(l."availableQty"), 0)::text        AS lotes,
           (i."quantity" - COALESCE(SUM(l."availableQty"), 0))::text AS diferencia
    FROM "inventory" i
    INNER JOIN "product" p ON p."id" = i."productId"
    LEFT JOIN "inventory_lot" l ON l."productId" = i."productId" AND l."storeId" = i."storeId"
    WHERE i."storeId" = ${storeId}
    GROUP BY i."productId", p."name", i."quantity"
    HAVING ABS(i."quantity" - COALESCE(SUM(l."availableQty"), 0)) > 0.0005
    ORDER BY p."name" ASC
  `;

  return filas.map((f) => ({
    productId: f.productId,
    productName: f.productName,
    inventario: Number(f.inventario),
    lotes: Number(f.lotes),
    diferencia: Number(f.diferencia),
  }));
}
