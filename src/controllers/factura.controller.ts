import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as facturaService from '../services/factura.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';

export const buscarVenta = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  if (!req.params.numero?.trim()) {
    throw ApiError.badRequest('El número de venta es requerido', 'NUMERO_REQUERIDO');
  }
  const venta = await facturaService.buscarVentaPorNumero(
    req.params.numero,
    req.user!.storeId
  );
  res.json({ venta });
});

export const emitirFactura = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { ventaId, saleNumber, clienteId, usoCfdi } = req.body;
  const resultado = await facturaService.emitirFactura({
    storeId: req.user!.storeId,
    userId: req.user!.id,
    ventaId,
    saleNumber,
    clienteId,
    usoCfdi,
  });
  res.status(201).json({ factura: resultado, message: `Factura ${resultado.folio} emitida` });
});

export const listarFacturas = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { startDate, endDate, status } = req.query as {
    startDate?: string;
    endDate?: string;
    status?: string;
  };
  const facturas = await facturaService.listarFacturas(req.user!.storeId, {
    startDate,
    endDate,
    status,
  });
  res.json({ facturas });
});

export const obtenerFactura = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const factura = await facturaService.obtenerFactura(req.params.id, req.user!.storeId);
  res.json({ factura });
});

export const cancelarFactura = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const factura = await facturaService.cancelarFactura(
    req.params.id,
    req.user!.storeId,
    req.user!.id
  );
  res.json({ factura, message: 'Factura cancelada' });
});
