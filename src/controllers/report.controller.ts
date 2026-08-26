import { Response } from 'express';
import { asyncAuthHandler, asyncHandler } from '../utils/asyncHandler';
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

export const dailyReport = asyncHandler(async (req, res: Response) => {
  const { storeId, date } = req.query as { storeId: string; date?: string };
  const result = await reportService.dailyReport(storeId, date);
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

export const monthlyReport = asyncHandler(async (req, res: Response) => {
  const { storeId, month } = req.query as { storeId: string; month?: string };
  const result = await reportService.monthlyReport(storeId, month);
  res.json(result);
});

export const productsReport = asyncHandler(async (req, res: Response) => {
  const { storeId } = req.query as { storeId: string };
  const result = await reportService.productsReport(storeId);
  res.json(result);
});

export const profitMarginReport = asyncHandler(async (req, res: Response) => {
  const { storeId } = req.query as { storeId: string };
  const result = await reportService.profitMarginByCategory(storeId);
  res.json(result);
});

export const suppliersReport = asyncHandler(async (req, res: Response) => {
  const { storeId } = req.query as { storeId: string };
  const result = await reportService.suppliersReport(storeId);
  res.json(result);
});