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
  const { entityType, entityId, cancellationReasonId, comment, items, type, cajaSessionId } = req.body;

  const cancellation = await cancelService.confirmCancellation({
    entityType,
    entityId,
    storeId: req.user!.storeId,
    userId: req.user!.id,
    cancellationReasonId,
    comment,
    items,
    type,
    cajaSessionId,
  });

  emitToStore(req.user!.storeId, 'inventory:updated', {
    storeId: req.user!.storeId,
    trigger: `cancel:${entityType.toLowerCase()}`,
  });

  // Si es devolución, también emitir evento de caja
  if (type === 'REFUND') {
    emitToStore(req.user!.storeId, 'caja:updated', {
      storeId: req.user!.storeId,
      trigger: 'refund',
    });
  }

  res.json({ cancellation, message: type === 'REFUND' ? 'Devolución registrada exitosamente' : 'Cancelación registrada exitosamente' });
});

export const listCancellations = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { startDate, endDate, entityType, cancellationReasonId, type } = req.query as {
    startDate?: string;
    endDate?: string;
    entityType?: string;
    cancellationReasonId?: string;
    type?: 'FULL' | 'PARTIAL' | 'REFUND';
  };

  const cancellations = await cancelService.listCancellations(req.user!.storeId, {
    startDate,
    endDate,
    entityType,
    cancellationReasonId,
    type,
  });

  res.json({ cancellations });
});
