import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as stockMovementService from '../services/stockMovement.service';
import { AuthedRequest } from '../types';
import { emitToStore } from '../socket/socket';

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

  res.status(201).json({ movement });
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
