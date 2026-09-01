import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as promoService from '../services/promotion.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const listPromotions = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { isActive, type, search, page, pageSize } = req.query as {
    isActive?: string;
    type?: string;
    search?: string;
    page?: string;
    pageSize?: string;
  };
  const result = await promoService.listPromotions({
    storeId: req.user!.storeId,
    isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    type,
    search,
    page: page ? parseInt(page, 10) : undefined,
    pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
  });
  res.json(result);
});

export const getPromotion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const promo = await promoService.getPromotion(req.params.id, req.user!.storeId);
  if (!promo) throw ApiError.notFound('Promoción no encontrada', 'PROMOTION_NOT_FOUND');
  res.json({ promotion: promo });
});

export const createPromotion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.storeId !== req.body.storeId) {
    throw ApiError.forbidden('No puedes operar en otra tienda', 'STORE_MISMATCH');
  }
  const promo = await promoService.createPromotion({
    storeId: req.user!.storeId,
    userId: req.user!.id,
    name: req.body.name,
    description: req.body.description ?? null,
    type: req.body.type,
    config: req.body.config,
    startsAt: new Date(req.body.startsAt),
    endsAt: new Date(req.body.endsAt),
    weekdays: req.body.weekdays ?? [],
    timeFrom: req.body.timeFrom ?? null,
    timeTo: req.body.timeTo ?? null,
    isActive: req.body.isActive ?? true,
    priority: req.body.priority ?? 0,
    maxUses: req.body.maxUses ?? null,
    items: req.body.items ?? [],
  });
  res.status(201).json({ promotion: promo });
});

export const updatePromotion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const promo = await promoService.updatePromotion(req.params.id, req.user!.storeId, {
    userId: req.user!.id,
    name: req.body.name,
    description: req.body.description,
    type: req.body.type,
    config: req.body.config,
    startsAt: req.body.startsAt ? new Date(req.body.startsAt) : undefined,
    endsAt: req.body.endsAt ? new Date(req.body.endsAt) : undefined,
    weekdays: req.body.weekdays,
    timeFrom: req.body.timeFrom,
    timeTo: req.body.timeTo,
    isActive: req.body.isActive,
    priority: req.body.priority,
    maxUses: req.body.maxUses,
    items: req.body.items,
  });
  res.json({ promotion: promo });
});

export const togglePromotion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { isActive } = req.body as { isActive: boolean };
  const result = await promoService.togglePromotion(
    req.params.id,
    req.user!.storeId,
    req.user!.id,
    isActive
  );
  res.json(result);
});

export const deletePromotion = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  await promoService.deletePromotion(req.params.id, req.user!.storeId, req.user!.id);
  res.json({ message: 'Promoción eliminada' });
});

export const getApplicable = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const promos = await promoService.getApplicablePromotionsForPos(req.user!.storeId);
  res.json({ promotions: promos });
});

export const previewPromotions = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const result = await promoService.previewPromotions({
    storeId: req.user!.storeId,
    items: req.body.items,
  });
  res.json(result);
});

export const getReport = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { startDate, endDate, type, promotionId } = req.query as {
    startDate?: string;
    endDate?: string;
    type?: string;
    promotionId?: string;
  };
  const report = await promoService.getPromotionReport({
    storeId: req.user!.storeId,
    startDate,
    endDate,
    type,
    promotionId,
  });
  res.json(report);
});
