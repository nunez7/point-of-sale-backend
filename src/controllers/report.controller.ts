import { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as reportService from '../services/report.service';

export const dailyReport = asyncHandler(async (req, res: Response) => {
  const { storeId, date } = req.query as { storeId: string; date?: string };
  const result = await reportService.dailyReport(storeId, date);
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