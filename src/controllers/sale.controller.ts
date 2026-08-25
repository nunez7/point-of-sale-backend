import { Response } from 'express';
import { asyncAuthHandler, asyncHandler } from '../utils/asyncHandler';
import * as saleService from '../services/sale.service';
import { emitToStore, emitToStoreExcept } from '../socket/socket';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';
import { checkStockAlert } from '../services/stockAlert.service';

export const createSale = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { items, paymentMethod, discount, storeId, status, clienteId, notes } = req.body;

  if (storeId !== req.user!.storeId) {
    throw ApiError.forbidden('Solo puedes operar en tu tienda', 'STORE_MISMATCH');
  }

  const result = await saleService.createSale({
    storeId,
    userId: req.user!.id,
    items,
    paymentMethod,
    discount: discount ?? 0,
    status,
    clienteId,
    notes,
  });

  // Los pedidos (PENDING) no descuentan inventario ni generan alertas hasta
  // confirmarse, así que solo emitimos eventos para ventas inmediatas.
  if (result.status !== 'PENDING') {
    // Se excluye el socket de la estación que creó la venta para no mostrarle
    // el aviso de "otra estación".
    emitToStoreExcept(storeId, 'sale:created', result, req.headers['x-socket-id']);
    emitToStore(storeId, 'inventory:updated', { storeId, trigger: 'sale' });

    // Alerta de inventario agotado/por agotarse por producto vendido.
    for (const item of items) {
      await checkStockAlert(storeId, item.productId, {
        delta: item.quantity,
        decrease: true,
      });
    }
  }

  res.status(201).json(result);
});

export const listSales = asyncHandler(async (req, res: Response) => {
  const { storeId, startDate, endDate } = req.query as {
    storeId?: string;
    startDate?: string;
    endDate?: string;
  };
  const sales = await saleService.listSales({ storeId, startDate, endDate });
  res.json({ sales });
});

export const getSale = asyncHandler(async (req, res: Response) => {
  const sale = await saleService.getSale(req.params.id, req.query.storeId as string);
  if (!sale) throw ApiError.notFound('Venta no encontrada', 'SALE_NOT_FOUND');
  res.json({ sale });
});

export const cancelSale = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const sale = await saleService.cancelSale(req.params.id, req.user!.storeId, req.user!.id);
  emitToStore(req.user!.storeId, 'inventory:updated', {
    storeId: req.user!.storeId,
    trigger: 'sale:canceled',
  });
  res.json({ sale, message: 'Venta cancelada e inventario restaurado' });
});

export const lookupSale = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { saleNumber } = req.query as { saleNumber: string };
  const sale = await saleService.getSaleBySaleNumber(req.user!.storeId, saleNumber);
  if (!sale) throw ApiError.notFound('Venta no encontrada', 'SALE_NOT_FOUND');
  res.json({ sale });
});

export const listOrders = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { storeId, status, startDate, endDate } = req.query as {
    storeId: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  };
  if (storeId !== req.user!.storeId) {
    throw ApiError.forbidden('Solo puedes operar en tu tienda', 'STORE_MISMATCH');
  }
  const orders = await saleService.listOrders({
    storeId,
    status: (status as 'PENDING' | 'COMPLETED' | 'CANCELED' | 'ALL') ?? 'PENDING',
    startDate,
    endDate,
  });
  res.json({ orders });
});

export const confirmOrder = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const sale = await saleService.confirmOrder(
    req.params.id,
    req.user!.storeId,
    req.user!.id
  );
  emitToStore(req.user!.storeId, 'inventory:updated', {
    storeId: req.user!.storeId,
    trigger: 'order:confirmed',
  });
  // Se excluye la estación que confirmó para no duplicar el aviso (ella ya
  // recibe el toast de "Pedido confirmado" desde el frontend).
  emitToStoreExcept(
    req.user!.storeId,
    'sale:created',
    { id: sale.id, saleNumber: sale.saleNumber },
    req.headers['x-socket-id']
  );
  res.json({ sale, message: 'Pedido confirmado e inventario actualizado' });
});

export const cancelOrder = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const sale = await saleService.cancelOrder(
    req.params.id,
    req.user!.storeId,
    req.user!.id
  );
  res.json({ sale, message: 'Pedido cancelado' });
});