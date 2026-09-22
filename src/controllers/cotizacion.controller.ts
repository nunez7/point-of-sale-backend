import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cotizacionService from '../services/cotizacion.service';
import { AuthedRequest } from '../types';
import { CotizacionStatus } from '../../generated/prisma/client.js';

export const createCotizacion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { items, discount, clienteId, notes, validUntil, status } = req.body;
  const cotizacion = await cotizacionService.createCotizacion(
    { items, discount, clienteId, notes, validUntil, status },
    req.user!.id,
    req.user!.storeId
  );
  res.status(201).json({ cotizacion, message: 'Cotización creada' });
});

export const listCotizaciones = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { status, startDate, endDate, clienteId, search } = req.query as {
    status?: string;
    startDate?: string;
    endDate?: string;
    clienteId?: string;
    search?: string;
  };
  const cotizaciones = await cotizacionService.listCotizaciones(req.user!.storeId, {
    status,
    startDate,
    endDate,
    clienteId,
    search,
  });
  res.json({ cotizaciones });
});

export const getCotizacion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const cotizacion = await cotizacionService.getCotizacion(req.params.id, req.user!.storeId);
  res.json({ cotizacion });
});

export const updateCotizacion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { items, discount, clienteId, notes, validUntil } = req.body;
  const cotizacion = await cotizacionService.updateCotizacion(
    req.params.id,
    { items, discount, clienteId, notes, validUntil },
    req.user!.id,
    req.user!.storeId
  );
  res.json({ cotizacion, message: 'Cotización actualizada' });
});

export const updateCotizacionStatus = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { status, motivo } = req.body;
  const cotizacion = await cotizacionService.updateCotizacionStatus(
    req.params.id,
    status as CotizacionStatus,
    req.user!.id,
    req.user!.storeId,
    motivo
  );
  res.json({ cotizacion, message: 'Estado actualizado' });
});

export const convertToSale = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const sale = await cotizacionService.convertToSale(req.params.id, req.user!.id, req.user!.storeId);
  res.json({ sale, message: 'Cotización convertida a pedido' });
});

export const deleteCotizacion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  await cotizacionService.deleteCotizacion(req.params.id, req.user!.id, req.user!.storeId);
  res.json({ message: 'Cotización eliminada' });
});
