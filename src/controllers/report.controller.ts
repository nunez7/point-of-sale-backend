import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as reportService from '../services/report.service';
import type { AuthedRequest } from '../types';

export const cierreCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { cajaId, userId, startDate, endDate } = req.query as {
    cajaId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  };
  const result = await reportService.cierreCaja(req.user!.storeId, {
    cajaId,
    userId,
    startDate,
    endDate,
  });
  res.json(result);
});

// Todos los reportes están scopeados a la tienda del usuario autenticado.
// Se ignora cualquier `storeId` enviado por el cliente.
export const dailyReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { date } = req.query as { date?: string };
  const result = await reportService.dailyReport(req.user!.storeId, date);
  res.json(result);
});

// El corte de caja se limita siempre a la tienda del usuario autenticado.
export const corteCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { date, startDate, endDate, operator } = req.query as {
    date?: string;
    startDate?: string;
    endDate?: string;
    operator?: string;
  };
  const result = await reportService.corteCaja(
    req.user!.storeId,
    date,
    startDate,
    endDate,
    operator ?? undefined
  );
  res.json(result);
});

export const monthlyReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { month } = req.query as { month?: string };
  const result = await reportService.monthlyReport(req.user!.storeId, month);
  res.json(result);
});

export const productsReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const result = await reportService.productsReport(req.user!.storeId);
  res.json(result);
});

export const profitMarginReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const result = await reportService.profitMarginByCategory(req.user!.storeId);
  res.json(result);
});

export const suppliersReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const result = await reportService.suppliersReport(req.user!.storeId);
  res.json(result);
});
