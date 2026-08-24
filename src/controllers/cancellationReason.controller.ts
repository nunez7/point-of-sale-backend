import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cancellationReasonService from '../services/cancellationReason.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const listReasons = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const includeInactive = req.query.includeInactive !== 'false';
  const reasons = await cancellationReasonService.listReasons(storeId, includeInactive);
  res.json({ reasons });
});

export const createReason = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const reason = await cancellationReasonService.createReason(storeId, {
    name: req.body.name,
    isActive: req.body.isActive ?? true,
  });
  res.status(201).json({ reason });
});

export const updateReason = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const id = req.params.id;
  const reason = await cancellationReasonService.updateReason(id, storeId, {
    name: req.body.name,
    isActive: req.body.isActive,
  });
  res.json({ reason });
});

export const deleteReason = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const id = req.params.id;
  if (!id) throw ApiError.badRequest('El id del motivo es requerido', 'BAD_REQUEST');
  const result = await cancellationReasonService.deleteReason(id, storeId);
  res.json(result);
});
