import { Response } from 'express';
import { asyncHandler, asyncAuthHandler } from '../utils/asyncHandler';
import * as supplierService from '../services/supplier.service';
import { emitToStore, emitToStoreExcept } from '../socket/socket';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const listSuppliers = asyncHandler(async (req, res: Response) => {
  const { storeId, search } = req.query as { storeId?: string; search?: string };
  const suppliers = await supplierService.listSuppliers(storeId, search);
  res.json({ suppliers });
});

// Lista de compras de toda la tienda (reporte recuperable).
export const listStoreTransactions = asyncHandler(async (req, res: Response) => {
  const { storeId, startDate, endDate } = req.query as {
    storeId?: string;
    startDate?: string;
    endDate?: string;
  };
  if (!storeId) {
    throw ApiError.badRequest('storeId es requerido', 'MISSING_STORE_ID');
  }
  const transactions = await supplierService.listStoreTransactions(storeId, {
    startDate,
    endDate,
  });
  res.json({ transactions });
});

// Detalle completo de una compra (para la "Nota de compra").
export const getTransactionById = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const transaction = await supplierService.getSupplierTransactionById(
    req.params.id,
    req.user!.storeId
  );
  res.json({ transaction });
});

export const createSupplier = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const supplier = await supplierService.createSupplier(req.body, req.user!.id);
  res.status(201).json({ supplier });
});

export const updateSupplier = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const supplier = await supplierService.updateSupplier(req.params.id, req.body, req.user!.id);
  res.json({ supplier });
});

export const getSupplierTransactions = asyncHandler(async (req, res: Response) => {
  const transactions = await supplierService.getSupplierTransactions(
    req.params.id,
    req.query.storeId as string
  );
  res.json({ transactions });
});

export const createSupplierTransaction = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const { supplierId, items, paymentMethod } = req.body;

    const transaction = await supplierService.createSupplierTransaction({
      supplierId,
      storeId: req.user!.storeId,
      userId: req.user!.id,
      items,
      paymentMethod,
    });

    // Se excluye el socket de la estación que registró la compra para no
    // mostrarle el aviso de "otra estación".
    emitToStoreExcept(req.user!.storeId, 'supplier-transaction:created', {
      id: transaction.id,
      supplierId: transaction.supplierId,
      total: Number(transaction.total),
      items: transaction.items.length,
    }, req.headers['x-socket-id']);
    emitToStore(req.user!.storeId, 'inventory:updated', {
      storeId: req.user!.storeId,
      trigger: 'supplier-transaction',
    });

    res.status(201).json(transaction);
  }
);