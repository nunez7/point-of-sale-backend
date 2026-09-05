import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as soporteService from '../services/soporte.service';
import { AuthedRequest } from '../types';
import { Role } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';

export const createTicket = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  if (user.role === Role.SOPORTE) {
    throw ApiError.forbidden(
      'El personal de soporte no puede crear tickets; solo el cliente',
      'FORBIDDEN_CREATE_TICKET'
    );
  }
  const ticket = await soporteService.createTicket(
    user.storeId,
    user.id,
    req.body,
    req.headers['x-socket-id']
  );
  res.status(201).json({ ticket, message: 'Ticket creado correctamente' });
});

export const listTickets = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const tickets = await soporteService.listTickets(
    user.role,
    user.storeId,
    user.id,
    req.query as never
  );
  res.json({ tickets });
});

export const getTicket = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const ticket = await soporteService.getTicket(req.params.id, user.role, user.storeId);
  res.json({ ticket });
});

export const updateStatus = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const ticket = await soporteService.updateStatus(
    req.params.id,
    user,
    req.body.status,
    req.body.comment,
    req.headers['x-socket-id']
  );
  res.json({ ticket, message: 'Estado actualizado' });
});

export const addComment = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const ticket = await soporteService.addComment(
    req.params.id,
    user,
    req.body.content,
    req.headers['x-socket-id']
  );
  res.json({ ticket, message: 'Comentario agregado' });
});

export const solveTicket = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const ticket = await soporteService.solveTicket(
    req.params.id,
    user,
    req.body,
    req.headers['x-socket-id']
  );
  res.json({ ticket, message: 'Ticket marcado como solucionado' });
});

export const closeTicket = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const ticket = await soporteService.closeTicket(
    req.params.id,
    user,
    req.body,
    req.headers['x-socket-id']
  );
  res.json({ ticket, message: 'Ticket cerrado' });
});

export const rejectTicket = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const ticket = await soporteService.rejectTicket(
    req.params.id,
    user,
    req.body,
    req.headers['x-socket-id']
  );
  res.json({ ticket, message: 'Cierre rechazado' });
});

export const getConfig = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const config = await soporteService.getTicketConfig(user.storeId);
  res.json({ config });
});

export const updateConfig = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const config = await soporteService.updateTicketConfig(
    user.storeId,
    req.body.soporteUserId ?? null
  );
  res.json({ config, message: 'Configuración actualizada' });
});
