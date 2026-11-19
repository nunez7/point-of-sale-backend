import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { dec, storeFixture } from '../helpers/fixtures';
import { getAlerts, getUmbrales, updateUmbrales } from '../../src/services/cajaUmbral.service';

describe('getUmbrales', () => {
  it('convierte los umbrales Decimal a número', async () => {
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({
        umbralAlertaEfectivo: dec('1500.50'),
        umbralAlertaTarjeta: dec('2500'),
        umbralAlertaEgresos: dec('300'),
      })
    );

    await expect(getUmbrales('store-1')).resolves.toEqual({
      umbralAlertaEfectivo: 1500.5,
      umbralAlertaTarjeta: 2500,
      umbralAlertaEgresos: 300,
    });
  });

  it('devuelve nulls cuando la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expect(getUmbrales('store-x')).resolves.toEqual({
      umbralAlertaEfectivo: null,
      umbralAlertaTarjeta: null,
      umbralAlertaEgresos: null,
    });
  });

  it('mantiene null los umbrales no configurados', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());

    await expect(getUmbrales('store-1')).resolves.toEqual({
      umbralAlertaEfectivo: null,
      umbralAlertaTarjeta: null,
      umbralAlertaEgresos: null,
    });
  });
});

describe('updateUmbrales', () => {
  it('solo actualiza los campos presentes y convierte a Decimal', async () => {
    prismaMock.store.update.mockResolvedValue(
      storeFixture({ umbralAlertaEfectivo: dec('1000') })
    );

    const resultado = await updateUmbrales('store-1', { umbralAlertaEfectivo: 1000 });

    const args = prismaMock.store.update.mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: 'store-1' });
    expect(Object.keys(args.data)).toEqual(['umbralAlertaEfectivo']);
    expect(args.data.umbralAlertaEfectivo.toString()).toBe('1000');
    expect(resultado).toEqual({
      umbralAlertaEfectivo: 1000,
      umbralAlertaTarjeta: null,
      umbralAlertaEgresos: null,
    });
  });

  it('permite limpiar un umbral enviando null', async () => {
    prismaMock.store.update.mockResolvedValue(storeFixture());

    await updateUmbrales('store-1', { umbralAlertaTarjeta: null });

    const args = prismaMock.store.update.mock.calls[0]?.[0];
    expect(args.data).toEqual({ umbralAlertaTarjeta: null });
  });

  it('envía un data vacío cuando no hay campos', async () => {
    prismaMock.store.update.mockResolvedValue(storeFixture());

    await updateUmbrales('store-1', {});

    const args = prismaMock.store.update.mock.calls[0]?.[0];
    expect(args.data).toEqual({});
  });

  it('actualiza tarjeta y egresos convirtiéndolos a Decimal', async () => {
    prismaMock.store.update.mockResolvedValue(
      storeFixture({
        umbralAlertaTarjeta: dec('800'),
        umbralAlertaEgresos: dec('250.75'),
      })
    );

    const resultado = await updateUmbrales('store-1', {
      umbralAlertaTarjeta: 800,
      umbralAlertaEgresos: 250.75,
    });

    const args = prismaMock.store.update.mock.calls[0]?.[0];
    expect(args.data.umbralAlertaTarjeta.toString()).toBe('800');
    expect(args.data.umbralAlertaEgresos.toString()).toBe('250.75');
    expect(resultado).toEqual({
      umbralAlertaEfectivo: null,
      umbralAlertaTarjeta: 800,
      umbralAlertaEgresos: 250.75,
    });
  });

  it('permite limpiar tarjeta y egresos enviando null', async () => {
    prismaMock.store.update.mockResolvedValue(storeFixture());

    await updateUmbrales('store-1', { umbralAlertaTarjeta: null, umbralAlertaEgresos: null });

    const args = prismaMock.store.update.mock.calls[0]?.[0];
    expect(args.data).toEqual({ umbralAlertaTarjeta: null, umbralAlertaEgresos: null });
  });
});

describe('getAlerts', () => {
  it('delega en el listado de alertas de caja', async () => {
    prismaMock.cajaAlert.findMany.mockResolvedValue([]);

    await getAlerts('store-1', 'sesion-1');

    expect(prismaMock.cajaAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 'store-1', cajaSessionId: 'sesion-1' },
      })
    );
  });
});
