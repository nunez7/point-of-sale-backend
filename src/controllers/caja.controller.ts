import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cajaService from '../services/caja.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const listCajas = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const cajas = await cajaService.listCajas(storeId);
  res.json({ cajas });
});

export const createCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const caja = await cajaService.createCaja(storeId, {
    name: req.body.name,
    assignedUserId: req.body.assignedUserId ?? null,
    isActive: req.body.isActive,
  });
  res.status(201).json({ caja });
});

export const updateCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const id = req.params.id;
  if (!id) throw ApiError.badRequest('El id de la caja es requerido', 'BAD_REQUEST');
  const caja = await cajaService.updateCaja(id, storeId, {
    name: req.body.name,
    assignedUserId: req.body.assignedUserId,
    isActive: req.body.isActive,
  });
  res.json({ caja });
});

export const deleteCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const id = req.params.id;
  if (!id) throw ApiError.badRequest('El id de la caja es requerido', 'BAD_REQUEST');
  const result = await cajaService.deleteCaja(id, storeId);
  res.json(result);
});
