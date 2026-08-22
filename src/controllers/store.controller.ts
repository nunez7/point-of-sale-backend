import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as storeService from '../services/store.service';
import { AuthedRequest } from '../types';

export const getCurrentStore = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const store = await storeService.getStoreById(req.user!.storeId);
  res.json({ store });
});

export const updateCurrentStore = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const store = await storeService.updateStore(req.user!.storeId, req.body, req.user!.id);
  res.json({ store });
});

export const updateDatosFiscalesStore = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const store = await storeService.updateStore(
      req.user!.storeId,
      req.body,
      req.user!.id,
      'UPDATE_DATOS_FISCALES'
    );
    res.json({ store, message: 'Datos fiscales del emisor actualizados' });
  }
);
