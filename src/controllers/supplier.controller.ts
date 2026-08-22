import { Response } from 'express';
import { asyncHandler, asyncAuthHandler } from '../utils/asyncHandler';
import * as supplierService from '../services/supplier.service';
import { emitToStore, emitToStoreExcept } from '../socket/socket';
import { AuthedRequest } from '../types';

export const listSuppliers = asyncHandler(async (req, res: Response) => {
  const { storeId } = req.query as { storeId?: string };
  const suppliers = await supplierService.listSuppliers(storeId);
  res.json({ suppliers });
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