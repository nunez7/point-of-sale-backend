import { Response } from 'express';
import { asyncHandler, asyncAuthHandler } from '../utils/asyncHandler';
import * as categoryService from '../services/category.service';
import { AuthedRequest } from '../types';

export const listCategories = asyncHandler(async (req, res: Response) => {
  const { storeId } = req.query as { storeId?: string };
  const categories = await categoryService.listCategories(storeId);
  res.json({ categories });
});

export const createCategory = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const category = await categoryService.createCategory(req.body, req.user!.id);
  res.status(201).json({ category });
});

export const updateCategory = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const category = await categoryService.updateCategory(req.params.id, req.body, req.user!.id);
  res.json({ category });
});

export const deleteCategory = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  await categoryService.deleteCategory(req.params.id, req.user!.id);
  res.json({ message: 'Categoría eliminada' });
});
