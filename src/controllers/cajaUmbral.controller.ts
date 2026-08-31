import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as cajaUmbralService from '../services/cajaUmbral.service';
import { AuthedRequest } from '../types';

export const getUmbrales = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const umbrales = await cajaUmbralService.getUmbrales(storeId);
  res.json(umbrales);
});

export const updateUmbrales = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  console.log('[DEBUG] updateUmbrales body:', JSON.stringify(req.body));
  const umbrales = await cajaUmbralService.updateUmbrales(storeId, req.body as Parameters<typeof cajaUmbralService.updateUmbrales>[1]);
  res.json(umbrales);
});

export const getAlerts = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const sessionId = req.query.sessionId as string | undefined;
  const alerts = await cajaUmbralService.getAlerts(storeId, sessionId);
  res.json({ alerts });
});
