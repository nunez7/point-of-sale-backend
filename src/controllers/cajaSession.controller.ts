import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cajaSessionService from '../services/cajaSession.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';
import { Role } from '../../generated/prisma/client.js';
import { emitToStore } from '../socket/socket';

export const openCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const userId = req.user!.id;
  const role = req.user!.role as Role;
  const cajaId = req.params.id;
  if (!cajaId) throw ApiError.badRequest('El id de la caja es requerido', 'BAD_REQUEST');

  const session = await cajaSessionService.openCaja(storeId, userId, role, cajaId, {
    openingCash: req.body.openingCash,
    openingElectronic: req.body.openingElectronic,
    openingNote: req.body.openingNote ?? null,
    authorizationToken: req.body.authorizationToken,
  });
  emitToStore(storeId, 'caja:updated', { sessionId: session.id, type: 'apertura' });
  res.status(201).json({ session });
});

export const closeCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const userId = req.user!.id;
  const role = req.user!.role as Role;
  const sessionId = req.params.id;
  if (!sessionId) throw ApiError.badRequest('El id de la sesi��n es requerido', 'BAD_REQUEST');

  const session = await cajaSessionService.closeCaja(
    sessionId,
    storeId,
    userId,
    role,
    req.body as cajaSessionService.CloseCajaInput
  );
  emitToStore(storeId, 'caja:updated', { sessionId, type: 'cierre' });
  res.json({ session });
});

export const reopenCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const userId = req.user!.id;
  const role = req.user!.role as Role;
  const sessionId = req.params.id;
  if (!sessionId) throw ApiError.badRequest('El id de la sesi��n es requerido', 'BAD_REQUEST');

  const session = await cajaSessionService.reopenCaja(
    sessionId,
    storeId,
    userId,
    role,
    req.body.motivo
  );
  emitToStore(storeId, 'caja:updated', { sessionId, type: 'reapertura' });
  res.json({ session });
});

export const getActiveSession = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const userId = req.user!.id;
  const session = await cajaSessionService.getActiveSession(storeId, userId);
  res.json({ session });
});

export const listSessions = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const { cajaId, status, startDate, endDate } = req.query as {
    cajaId?: string;
    status?: 'OPEN' | 'CLOSED';
    startDate?: string;
    endDate?: string;
  };
  const sessions = await cajaSessionService.listSessions(storeId, {
    cajaId,
    status,
    startDate,
    endDate,
  });
  res.json({ sessions });
});

export const getSessionReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const id = req.params.id;
  if (!id) throw ApiError.badRequest('El id de la sesión es requerido', 'BAD_REQUEST');
  const report = await cajaSessionService.getSessionReport(id, storeId);
  res.json(report);
});

export const getSessionPreview = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const id = req.params.id;
  if (!id) throw ApiError.badRequest('El id de la sesión es requerido', 'BAD_REQUEST');
  const preview = await cajaSessionService.previsualizarCorte(id, storeId);
  res.json(preview);
});
