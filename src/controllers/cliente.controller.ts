import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as clienteService from '../services/cliente.service';
import { AuthedRequest } from '../types';

export const listarClientes = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { search } = req.query as { search?: string };
  const clientes = await clienteService.listarClientes(req.user!.storeId, search);
  res.json({ clientes });
});

export const obtenerCliente = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const cliente = await clienteService.obtenerCliente(req.params.id, req.user!.storeId);
  res.json({ cliente });
});

export const crearCliente = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const cliente = await clienteService.crearCliente(req.user!.storeId, req.user!.id, req.body);
  res.status(201).json({ cliente, message: 'Cliente registrado' });
});

export const actualizarCliente = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const cliente = await clienteService.actualizarCliente(
    req.params.id,
    req.user!.storeId,
    req.user!.id,
    req.body
  );
  res.json({ cliente, message: 'Cliente actualizado' });
});

export const eliminarCliente = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  await clienteService.eliminarCliente(req.params.id, req.user!.storeId, req.user!.id);
  res.json({ message: 'Cliente eliminado' });
});
