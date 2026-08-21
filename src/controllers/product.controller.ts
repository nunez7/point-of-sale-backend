import { Response } from 'express';
import { asyncHandler, asyncAuthHandler } from '../utils/asyncHandler';
import * as productService from '../services/product.service';
import * as inventoryService from '../services/inventory.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const listProducts = asyncHandler(async (req, res: Response) => {
  const { storeId, search, category, includeInactive } = req.query as {
    storeId?: string;
    search?: string;
    category?: string;
    includeInactive?: string;
  };
  const products = await productService.listProducts({
    storeId,
    search,
    category,
    includeInactive: includeInactive === 'true',
  });
  res.json({ products });
});

export const getProduct = asyncHandler(async (req, res: Response) => {
  const product = await productService.getProduct(req.params.id);
  if (!product) throw ApiError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');
  res.json({ product });
});

export const getSiguienteCodigo = asyncAuthHandler(async (_req: AuthedRequest, res: Response) => {
  const sku = await productService.obtenerSiguienteSku();
  res.json({ sku });
});

export const createProduct = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const product = await productService.createProduct(req.body, req.user!.id);
  res.status(201).json({ product });
});

export const updateProduct = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const product = await productService.updateProduct(req.params.id, req.body, req.user!.id);
  res.json({ product });
});

export const deleteProduct = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const product = await productService.deleteProduct(req.params.id, req.user!.id);
  res.json({ product, message: 'Producto eliminado' });
});

export const getInventory = asyncHandler(async (req, res: Response) => {
  const inventory = await inventoryService.getInventoryByStore(req.params.storeId);
  res.json({ inventory });
});

export const getLowStock = asyncHandler(async (req, res: Response) => {
  const lowStock = await inventoryService.getLowStock(req.params.storeId);
  res.json({ lowStock });
});