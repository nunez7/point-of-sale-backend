import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cajaMotivoService from '../services/cajaMovimientoMotivo.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const listMotivos = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const includeInactive = req.query.includeInactive !== 'false';
  const motivos = await cajaMotivoService.listMotivos(storeId, includeInactive);
  res.json({ motivos });
});

export const createMotivo = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const motivo = await cajaMotivoService.createMotivo(storeId, req.body);
  res.status(201).json({ motivo });
});

export const updateMotivo = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const { id } = req.params;
  if (!id) throw ApiError.badRequest('El id del motivo es requerido', 'BAD_REQUEST');
  const motivo = await cajaMotivoService.updateMotivo(storeId, id, req.body);
  res.json({ motivo });
});

export const deleteMotivo = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const { id } = req.params;
  if (!id) throw ApiError.badRequest('El id del motivo es requerido', 'BAD_REQUEST');
  await cajaMotivoService.deleteMotivo(storeId, id);
  res.json({ message: 'Motivo eliminado' });
});
