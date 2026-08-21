import { Response } from 'express';
import { asyncHandler, asyncAuthHandler } from '../utils/asyncHandler';
import * as saleService from '../services/sale.service';
import { emitToStore } from '../socket/socket';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const createSale = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { items, paymentMethod, discount, storeId } = req.body;

  if (storeId !== req.user!.storeId) {
    throw ApiError.forbidden('Solo puedes operar en tu tienda', 'STORE_MISMATCH');
  }

  const result = await saleService.createSale({
    storeId,
    userId: req.user!.id,
    items,
    paymentMethod,
    discount: discount ?? 0,
  });

  emitToStore(storeId, 'sale:created', result);
  emitToStore(storeId, 'inventory:updated', { storeId, trigger: 'sale' });

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