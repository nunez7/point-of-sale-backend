import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as auditService from '../services/audit.service';
import { AuthedRequest } from '../types';

export const listAuditLogs = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const { startDate, endDate, entity, action, userId, search, page, pageSize } = req.query as {
    startDate?: string;
    endDate?: string;
    entity?: string;
    action?: string;
    userId?: string;
    search?: string;
    page?: string;
    pageSize?: string;
  };

  const result = await auditService.listAuditLogs(storeId, {
    startDate,
    endDate,
    entity,
    action,
    userId,
    search,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });

  res.json(result);
});
