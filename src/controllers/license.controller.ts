import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as licenseService from '../services/license.service';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest } from '../types';
import { Role } from '../../generated/prisma/client.js';

// Estado de la licencia de la tienda activa. Lo consume el POS para mostrar el
// aviso de vencimiento y para bloquear la apertura de cajas.
export const getEstado = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;
  const [estado, instalacion] = await Promise.all([
    licenseService.estadoLicencia(storeId),
    licenseService.estadoInstalacion(),
  ]);
  res.json({ licencia: estado, instalacion });
});

export const getInstalacion = asyncAuthHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ instalacion: await licenseService.estadoInstalacion() });
});

export const activar = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const resultado = await licenseService.activarLicencia(req.body.token, req.user!.id);
  res.json(resultado);
});

export const listarEventos = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const eventos = await licenseService.listarEventosLicencia(req.user!.storeId);
  res.json({ eventos });
});

// Asigna la licencia operativa a una caja concreta (cuando hay cupo).
export const activarCaja = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const id = req.params.id;
  if (!id) throw ApiError.badRequest('El id de la caja es requerido', 'BAD_REQUEST');
  const licencia = await licenseService.activarCaja(id, req.user!.storeId, req.user!.id);
  res.json({ cajaLicencia: licencia });
});

/**
 * Panel del creador: todas las tiendas de la instalación con su vencimiento.
 * Se restringe a SOPORTE de forma explícita porque el rol ADMIN del cliente
 * también tiene rango 3 en la jerarquía.
 */
export const resumen = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role !== Role.SOPORTE) {
    throw ApiError.forbidden(
      'Solo el usuario de soporte puede ver el resumen de licencias',
      'INSUFFICIENT_ROLE'
    );
  }
  res.json(await licenseService.resumenLicenciasInstalacion());
});
