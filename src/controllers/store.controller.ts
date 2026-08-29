import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as storeService from '../services/store.service';
import { AuthedRequest } from '../types';
import { scheduleStoreAutoClose, stopStoreAutoClose } from '../services/scheduler.service';

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

export const getAutoCloseConfig = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const config = await storeService.getAutoCloseConfig(req.user!.storeId);
  res.json({ config });
});

export const updateAutoCloseConfig = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const { autoCloseEnabled, autoCloseTime, autoCloseDays } = req.body;

  const store = await storeService.updateStore(storeId, {
    autoCloseEnabled,
    autoCloseTime,
    autoCloseDays,
  }, req.user!.id, 'UPDATE_AUTO_CLOSE_CONFIG');

  if (store.autoCloseEnabled && store.autoCloseTime) {
    scheduleStoreAutoClose(storeId, store.autoCloseTime, store.autoCloseDays);
  } else {
    stopStoreAutoClose(storeId);
  }

  res.json({ store, message: 'Configuración de cierre automático actualizada' });
});
