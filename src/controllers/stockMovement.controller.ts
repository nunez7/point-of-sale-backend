import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as stockMovementService from '../services/stockMovement.service';
import { AuthedRequest } from '../types';
import { emitToStore } from '../socket/socket';
import { checkStockAlert } from '../services/stockAlert.service';

export const createMovement = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const movement = await stockMovementService.createMovement({
    storeId,
    userId: req.user!.id,
    productId: req.body.productId,
    reasonId: req.body.reasonId,
    quantity: req.body.quantity,
    comment: req.body.comment ?? null,
  });

  emitToStore(storeId, 'inventory:updated', { productId: movement.productId });
  emitToStore(storeId, 'inventory-movement:created', movement);

  if (movement.tipo === 'SALIDA') {
    await checkStockAlert(storeId, movement.productId, { before: movement.balanceBefore });
  }

  res.status(201).json({ movement });
});

export const createMovementBatch = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const { reasonId, comment, items } = req.body as {
    reasonId: string;
    comment?: string | null;
    items: { productId: string; quantity: number; comment?: string | null }[];
  };
  const movements = await stockMovementService.createMovementBatch({
    storeId,
    userId: req.user!.id,
    reasonId,
    comment: comment ?? null,
    items,
  });

  for (const m of movements) {
    emitToStore(storeId, 'inventory:updated', { productId: m.productId });
    emitToStore(storeId, 'inventory-movement:created', m);
    if (m.tipo === 'SALIDA') {
      await checkStockAlert(storeId, m.productId, { before: m.balanceBefore });
    }
  }

  res.status(201).json({ movements });
});

export const listMovements = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const { startDate, endDate, productId, tipo, reasonId, status } = req.query as {
    startDate?: string;
    endDate?: string;
    productId?: string;
    tipo?: 'ENTRADA' | 'SALIDA';
    reasonId?: string;
    status?: 'ACTIVE' | 'CANCELLED';
  };
  const movements = await stockMovementService.listMovements(storeId, {
    startDate,
    endDate,
    productId,
    tipo,
    reasonId,
    status,
  });
  res.json({ movements });
});

export const cancelMovement = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const id = req.params.id;
  const inverse = await stockMovementService.cancelMovement(
    id,
    storeId,
    req.user!.id,
    req.body.cancellationReason,
    req.body.cancellationComment ?? null
  );

  emitToStore(storeId, 'inventory:updated', { productId: inverse.productId });
  emitToStore(storeId, 'inventory-movement:created', inverse);

  // La cancelación crea un movimiento inverso; si es SALIDA resta stock.
  if (inverse.tipo === 'SALIDA') {
    await checkStockAlert(storeId, inverse.productId, { before: inverse.balanceBefore });
  }

  res.json({ movement: inverse });
});

export const registerOpening = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const date = req.body.date ?? (req.query.date as string | undefined);
  const result = await stockMovementService.registerOpening(storeId, date);
  res.status(201).json(result);
});

export const getOpening = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const date = req.query.date as string | undefined;
  const result = await stockMovementService.hasOpening(storeId, date);
  res.json(result);
});

export const getInventoryReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const date = req.query.date as string | undefined;
  const report = await stockMovementService.getInventoryReport(storeId, date);
  res.json(report);
});
