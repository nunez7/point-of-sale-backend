import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cancelService from '../services/cancel.service';
import { emitToStore } from '../socket/socket';
import { AuthedRequest } from '../types';

export const lookupEntity = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType, entityCode } = req.query as {
    entityType?: string;
    entityCode?: string;
  };

  if (!entityType || !entityCode) {
    res.status(400).json({ error: 'entityType y entityCode son requeridos', code: 'MISSING_PARAMS' });
    return;
  }

  const entity = await cancelService.lookupEntity(entityType, entityCode, req.user!.storeId);
  res.json({ entity });
});

export const confirmCancellation = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType, entityId, reason, comment } = req.body;

  const cancellation = await cancelService.confirmCancellation(
    entityType,
    entityId,
    req.user!.storeId,
    req.user!.id,
    reason,
    comment
  );

  emitToStore(req.user!.storeId, 'inventory:updated', {
    storeId: req.user!.storeId,
    trigger: `cancel:${entityType.toLowerCase()}`,
  });

  res.json({ cancellation, message: 'Cancelación registrada exitosamente' });
});

export const listCancellations = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { startDate, endDate, entityType, reason } = req.query as {
    startDate?: string;
    endDate?: string;
    entityType?: string;
    reason?: string;
  };

  const cancellations = await cancelService.listCancellations(req.user!.storeId, {
    startDate,
    endDate,
    entityType,
    reason,
  });

  res.json({ cancellations });
});
