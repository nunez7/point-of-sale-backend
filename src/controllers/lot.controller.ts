import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as lotService from '../services/lot.service';
import { AuthedRequest } from '../types';

// GET /api/inventory/lots
// Lotes con su caducidad y saldo. Por defecto solo los que tienen existencia.
export const listLots = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { productId, search, conSaldo, vencimiento, venceEn, page, limit, diasAviso } =
    req.query as {
      productId?: string;
      search?: string;
      conSaldo?: string;
      vencimiento?: 'TODOS' | 'POR_VENCER' | 'CADUCADO' | 'SIN_CADUCIDAD';
      venceEn?: string;
      page?: string;
      limit?: string;
      diasAviso?: string;
    };

  const result = await lotService.listarLotes(req.user!.storeId, {
    productId,
    search,
    conSaldo: conSaldo !== 'false',
    vencimiento,
    venceEnDias: venceEn ? Math.max(0, parseInt(venceEn, 10) || 0) : undefined,
    diasAviso: diasAviso ? Math.max(0, parseInt(diasAviso, 10) || 0) : undefined,
    page: page ? Math.max(1, parseInt(page, 10) || 1) : undefined,
    limit: limit ? Math.min(200, Math.max(1, parseInt(limit, 10) || 50)) : undefined,
  });

  res.json(result);
});

// GET /api/inventory/lots/por-vencer?dias=7
// Lotes con saldo que caducan dentro de N días, más los ya caducados.
export const getExpiringLots = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const dias = Math.max(0, parseInt(String(req.query.dias ?? '7'), 10) || 7);
  const result = await lotService.lotesPorVencer(req.user!.storeId, dias);
  res.json(result);
});

// GET /api/inventory/lots/cuadre
// Diagnóstico: productos donde el total del inventario no coincide con sus
// lotes. Debe devolver una lista vacía en operación normal.
export const getLotsBalance = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const differences = await lotService.verificarCuadre(req.user!.storeId);
  res.json({ ok: differences.length === 0, differences });
});
