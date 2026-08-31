import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cajaMovimientoService from '../services/cajaMovimiento.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';
import { emitToStore } from '../socket/socket';

export const crearMovimiento = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const userId = req.user!.id;
  const sessionId = req.params.id;
  if (!sessionId) throw ApiError.badRequest('El id de la sesión es requerido', 'BAD_REQUEST');

  const movimiento = await cajaMovimientoService.crearMovimiento(storeId, userId, sessionId, {
    tipo: req.body.tipo,
    metodo: req.body.metodo ?? 'CASH',
    monto: req.body.monto,
    motivoId: req.body.motivoId ?? null,
    motivoTexto: req.body.motivoTexto ?? null,
  });

  emitToStore(storeId, 'caja:updated', { sessionId, type: 'movimiento' });
  res.status(201).json({ movimiento });
});

export const listarMovimientos = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const sessionId = req.params.id;
  if (!sessionId) throw ApiError.badRequest('El id de la sesión es requerido', 'BAD_REQUEST');

  const movimientos = await cajaMovimientoService.listarMovimientos(storeId, sessionId);
  res.json({ movimientos });
});
