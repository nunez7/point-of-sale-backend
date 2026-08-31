import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as productService from '../services/product.service';
import * as inventoryService from '../services/inventory.service';
import { getStockAlerts as fetchStockAlerts } from '../services/stockAlert.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

// Productos: scopeados a la tienda del usuario autenticado.
export const listProducts = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { search, category, includeInactive, page, limit, sortBy, sortOrder } = req.query as {
    search?: string;
    category?: string;
    includeInactive?: string;
    page?: string;
    limit?: string;
    sortBy?: 'name' | 'category' | 'sku' | 'costPrice' | 'sellingPrice';
    sortOrder?: 'asc' | 'desc';
  };

  const result = await productService.listProducts({
    storeId: req.user!.storeId,
    search,
    category,
    includeInactive: includeInactive === 'true',
    page: page ? Math.max(1, parseInt(page, 10) || 1) : undefined,
    limit: limit
      ? Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
      : undefined,
    sortBy,
    sortOrder,
  });
  res.json(result);
});

export const getProduct = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  // El producto debe pertenecer a la tienda del token para evitar fugas.
  const product = await productService.getProduct(req.params.id, req.user!.storeId);
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

// Inventario: scopeado a la tienda del usuario autenticado. La ruta ya no
// recibe :storeId.
export const getInventory = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { search, page, limit, sortBy, sortOrder } = req.query as {
    search?: string;
    page?: string;
    limit?: string;
    sortBy?: 'name' | 'category' | 'quantity' | 'lowStockThreshold';
    sortOrder?: 'asc' | 'desc';
  };
  const result = await inventoryService.getInventoryByStore(req.user!.storeId, {
    search,
    page: page ? Math.max(1, parseInt(page, 10) || 1) : undefined,
    limit: limit ? Math.min(200, Math.max(1, parseInt(limit, 10) || 50)) : undefined,
    sortBy,
    sortOrder,
  });
  res.json(result);
});

export const getLowStock = asyncAuthHandler(async (_req: AuthedRequest, res: Response) => {
  const lowStock = await inventoryService.getLowStock(_req.user!.storeId);
  res.json({ lowStock });
});

export const getStockAlerts = asyncAuthHandler(async (_req: AuthedRequest, res: Response) => {
  const alerts = await fetchStockAlerts(_req.user!.storeId);
  res.json({ alerts });
});
