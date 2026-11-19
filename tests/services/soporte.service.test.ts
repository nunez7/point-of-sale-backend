import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { expectApiError } from '../helpers/expectApiError';
import { emitToStore } from '../../src/socket/socket';
import {
  addComment,
  closeTicket,
  createTicket,
  getTicket,
  getTicketConfig,
  listTickets,
  rejectTicket,
  solveTicket,
  updateStatus,
  updateTicketConfig,
} from '../../src/services/soporte.service';

// ───────────────────────────────────────────────────────────────────────────
// Fixtures locales
// ───────────────────────────────────────────────────────────────────────────

const AHORA = new Date('2026-01-15T18:00:00.000Z');

function usuarioTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    name: 'Vendedor de Prueba',
    email: 'vendedor@servicaja.com',
    role: 'VENDEDOR',
    ...overrides,
  };
}

/** Ticket con las relaciones de `TICKET_INCLUDE` (listado y respuestas de escritura). */
function ticketConRelaciones(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    folio: 'TICKET-STORE001-0001',
    storeId: 'store-1',
    userId: 'user-1',
    assignedToSoporteId: null as string | null,
    ticketModule: 'INVENTORY',
    subject: 'No cuadra el inventario',
    description: 'Faltan 3 piezas en el conteo',
    priority: 'MEDIUM',
    status: 'OPEN',
    solutionEvidence: null as string | null,
    solutionComment: null as string | null,
    rating: null as number | null,
    ratingComment: null as string | null,
    rejectReason: null as string | null,
    createdAt: AHORA,
    updatedAt: AHORA,
    user: usuarioTicket(),
    assignedToSoporte: null as Record<string, unknown> | null,
    store: { id: 'store-1', name: 'Abarrotes Servicaja', code: 'STORE001' },
    attachments: [] as Array<Record<string, unknown>>,
    _count: { comments: 0 },
    ...overrides,
  };
}

/** Ticket con las relaciones de `TICKET_DETAIL_INCLUDE` (detalle). */
function ticketDetalle(overrides: Record<string, unknown> = {}) {
  return {
    ...ticketConRelaciones(),
    solutionEvidenceFileName: null as string | null,
    solutionEvidenceMimeType: null as string | null,
    attachments: [] as Array<Record<string, unknown>>,
    comments: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

/** Ticket "pelado" que devuelve `findUnique` sin `include`. */
function ticketBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    folio: 'TICKET-STORE001-0001',
    storeId: 'store-1',
    userId: 'user-1',
    assignedToSoporteId: null as string | null,
    ticketModule: 'INVENTORY',
    subject: 'No cuadra el inventario',
    description: 'Faltan 3 piezas en el conteo',
    priority: 'MEDIUM',
    status: 'OPEN',
    solutionEvidence: null,
    solutionComment: null,
    rating: null,
    ratingComment: null,
    rejectReason: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

const SOPORTE = { id: 'soporte-1', role: 'SOPORTE', storeId: 'store-soporte' };
const ADMIN = { id: 'admin-1', role: 'ADMIN', storeId: 'store-1' };

// ───────────────────────────────────────────────────────────────────────────
// createTicket
// ───────────────────────────────────────────────────────────────────────────

describe('createTicket', () => {
  it('genera el folio, adjunta la evidencia y notifica el ticket creado', async () => {
    prismaMock.ticketConfig.findUnique.mockResolvedValue({
      storeId: 'store-1',
      soporteUserId: 'soporte-1',
    });
    prismaMock.store.findUnique.mockResolvedValue({ code: 'STORE001' });
    prismaMock.store.update.mockResolvedValue({ ticketSequence: 7 });
    prismaMock.ticket.create.mockResolvedValue(
      ticketConRelaciones({
        folio: 'TICKET-STORE001-0007',
        assignedToSoporteId: 'soporte-1',
        assignedToSoporte: { id: 'soporte-1', name: 'Soporte Uno', email: 'soporte@servicaja.com' },
        attachments: [
          { id: 'att-1', fileName: 'evidencia.png', mimeType: 'image/png', createdAt: AHORA },
        ],
        _count: { comments: 2 },
      })
    );
    prismaMock.user.findUnique.mockResolvedValue(usuarioTicket());

    const resultado = await createTicket('store-1', 'user-1', {
      ticketModule: 'INVENTORY',
      subject: 'No cuadra el inventario',
      description: 'Faltan 3 piezas en el conteo',
      attachment: { fileName: 'evidencia.png', mimeType: 'image/png', data: 'YmFzZTY0' },
    });

    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { ticketSequence: { increment: 1 } },
      select: { ticketSequence: true },
    });
    const datos = prismaMock.ticket.create.mock.calls[0][0].data;
    expect(datos).toMatchObject({
      folio: 'TICKET-STORE001-0007',
      storeId: 'store-1',
      userId: 'user-1',
      ticketModule: 'INVENTORY',
      priority: 'MEDIUM',
      status: 'OPEN',
      assignedToSoporteId: 'soporte-1',
    });
    expect(datos.attachments).toEqual({
      create: { fileName: 'evidencia.png', mimeType: 'image/png', data: 'YmFzZTY0' },
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({
      folio: 'TICKET-STORE001-0007',
      hasEvidence: false,
      commentCount: 2,
      createdAt: AHORA.toISOString(),
      attachments: [
        {
          id: 'att-1',
          fileName: 'evidencia.png',
          mimeType: 'image/png',
          createdAt: AHORA.toISOString(),
        },
      ],
    });
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:created',
      expect.objectContaining({
        folio: 'TICKET-STORE001-0007',
        priority: 'MEDIUM',
        assignedToSoporteName: 'Soporte Uno',
        triggeredBy: expect.objectContaining({
          id: 'user-1',
          name: 'Vendedor de Prueba',
          role: 'VENDEDOR',
        }),
      })
    );
  });

  it('sin configuración de soporte, sin adjunto y con prioridad explícita no emite evento si falta el creador', async () => {
    prismaMock.ticketConfig.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue({ code: 'STORE001' });
    prismaMock.store.update.mockResolvedValue({ ticketSequence: 1 });
    prismaMock.ticket.create.mockResolvedValue(ticketConRelaciones({ priority: 'URGENT' }));
    prismaMock.user.findUnique.mockResolvedValue(null);

    const resultado = await createTicket('store-1', 'user-9', {
      ticketModule: 'SALES',
      subject: 'No imprime',
      description: 'La impresora no responde',
      priority: 'URGENT',
      attachment: null,
    });

    const datos = prismaMock.ticket.create.mock.calls[0][0].data;
    expect(datos.priority).toBe('URGENT');
    expect(datos.assignedToSoporteId).toBeNull();
    expect(datos.attachments).toBeUndefined();
    expect(resultado).toMatchObject({ folio: 'TICKET-STORE001-0001' });
    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('lanza STORE_NOT_FOUND cuando la tienda no existe', async () => {
    prismaMock.ticketConfig.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(
      () =>
        createTicket('store-404', 'user-1', {
          ticketModule: 'INVENTORY',
          subject: 'X',
          description: 'Y',
        }),
      { status: 404, code: 'STORE_NOT_FOUND', message: 'Tienda no encontrada' }
    );
    expect(prismaMock.ticket.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listTickets
// ───────────────────────────────────────────────────────────────────────────

describe('listTickets', () => {
  it('limita los tickets a la tienda del actor cuando no es soporte', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([
      ticketConRelaciones({
        solutionEvidence: 'ZXZpZGVuY2lh',
        attachments: [
          { id: 'att-1', fileName: 'a.png', mimeType: 'image/png', createdAt: AHORA },
        ],
        _count: { comments: 1 },
      }),
    ]);

    const resultado = await listTickets('VENDEDOR', 'store-1', 'user-1', {});

    expect(prismaMock.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 'store-1' }, orderBy: { createdAt: 'desc' } })
    );
    expect(resultado[0]).toMatchObject({ hasEvidence: true, commentCount: 1 });
    expect(resultado[0].attachments[0].createdAt).toBe(AHORA.toISOString());
  });

  it('permite a soporte filtrar por tienda y sin tienda ve todos los tickets', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([]);

    await listTickets('SOPORTE', 'store-soporte', 'soporte-1', { storeId: 'store-2' });
    expect(prismaMock.ticket.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { storeId: 'store-2' } })
    );

    await listTickets('SOPORTE', 'store-soporte', 'soporte-1', {});
    expect(prismaMock.ticket.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: {} })
    );
  });

  it('combina todos los filtros disponibles, incluida la búsqueda y el rango de fechas', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([]);

    await listTickets('SOPORTE', 'store-soporte', 'soporte-1', {
      status: 'OPEN',
      ticketModule: 'SALES',
      priority: 'HIGH',
      assignedToSoporteId: 'soporte-1',
      search: 'impresora',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(prismaMock.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'OPEN',
          ticketModule: 'SALES',
          priority: 'HIGH',
          assignedToSoporteId: 'soporte-1',
          OR: [
            { folio: { contains: 'impresora', mode: 'insensitive' } },
            { subject: { contains: 'impresora', mode: 'insensitive' } },
            { description: { contains: 'impresora', mode: 'insensitive' } },
          ],
          createdAt: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lte: new Date('2026-01-31T23:59:59.999Z'),
          },
        },
      })
    );
  });

  it('filtra solo por fecha inicial', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([]);

    await listTickets('ADMIN', 'store-1', 'admin-1', { startDate: '2026-02-01' });

    expect(prismaMock.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: 'store-1',
          createdAt: { gte: new Date('2026-02-01T00:00:00.000Z') },
        },
      })
    );
  });

  it('filtra solo por fecha final', async () => {
    prismaMock.ticket.findMany.mockResolvedValue([]);

    await listTickets('ADMIN', 'store-1', 'admin-1', { endDate: '2026-02-28' });

    expect(prismaMock.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: 'store-1',
          createdAt: { lte: new Date('2026-02-28T23:59:59.999Z') },
        },
      })
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getTicket
// ───────────────────────────────────────────────────────────────────────────

describe('getTicket', () => {
  it('devuelve el detalle con comentarios, adjuntos y evidencia', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(
      ticketDetalle({
        solutionEvidence: 'ZXZpZGVuY2lh',
        solutionEvidenceFileName: 'fix.png',
        solutionEvidenceMimeType: 'image/png',
        solutionComment: 'Se reinició el servicio',
        attachments: [
          {
            id: 'att-1',
            fileName: 'error.png',
            mimeType: 'image/png',
            data: 'YmFzZTY0',
            createdAt: AHORA,
          },
        ],
        comments: [
          {
            id: 'com-1',
            content: 'Revisando',
            user: usuarioTicket({ id: 'soporte-1', name: 'Soporte Uno', role: 'SOPORTE' }),
            createdAt: AHORA,
          },
        ],
      })
    );

    const resultado = await getTicket('ticket-1', 'ADMIN', 'store-1');

    expect(resultado).toMatchObject({
      id: 'ticket-1',
      hasEvidence: true,
      solutionEvidenceFileName: 'fix.png',
      solutionEvidenceMimeType: 'image/png',
      attachments: [
        {
          id: 'att-1',
          fileName: 'error.png',
          mimeType: 'image/png',
          data: 'YmFzZTY0',
          createdAt: AHORA.toISOString(),
        },
      ],
      comments: [
        {
          id: 'com-1',
          content: 'Revisando',
          user: expect.objectContaining({ role: 'SOPORTE' }),
          createdAt: AHORA.toISOString(),
        },
      ],
    });
  });

  it('permite a soporte ver tickets de cualquier tienda', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketDetalle());

    const resultado = await getTicket('ticket-1', 'SOPORTE', 'store-soporte');

    expect(resultado).toMatchObject({ id: 'ticket-1', hasEvidence: false });
  });

  it('lanza TICKET_NOT_FOUND cuando el ticket no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expectApiError(() => getTicket('ticket-404', 'ADMIN', 'store-1'), {
      status: 404,
      code: 'TICKET_NOT_FOUND',
      message: 'Ticket no encontrado',
    });
  });

  it('lanza FORBIDDEN_TICKET cuando el ticket es de otra tienda', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketDetalle({ storeId: 'store-2' }));

    await expectApiError(() => getTicket('ticket-1', 'ADMIN', 'store-1'), {
      status: 403,
      code: 'FORBIDDEN_TICKET',
      message: 'No tienes permiso para ver este ticket',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// updateStatus
// ───────────────────────────────────────────────────────────────────────────

describe('updateStatus', () => {
  it('cambia el estado, se autoasigna y registra el comentario en el hilo', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());
    prismaMock.ticket.update.mockResolvedValue(ticketConRelaciones({ status: 'ANALYSIS' }));

    const resultado = await updateStatus('ticket-1', SOPORTE, 'ANALYSIS', 'revisando');

    const datos = prismaMock.ticket.update.mock.calls[0][0].data;
    expect(datos.status).toBe('ANALYSIS');
    expect(datos.assignedToSoporteId).toBe('soporte-1');
    expect(datos.comments).toEqual({
      create: { userId: 'soporte-1', content: 'Cambio de estado → En análisis: revisando' },
    });
    expect(resultado).toMatchObject({ status: 'ANALYSIS' });
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:updated',
      expect.objectContaining({
        ticketId: 'ticket-1',
        statusLabel: 'En análisis',
        triggeredBy: { id: 'soporte-1', name: 'Soporte', role: 'SOPORTE' },
      })
    );
  });

  it('respeta el soporte ya asignado y usa su nombre cuando no hay comentario', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(
      ticketBase({ assignedToSoporteId: 'soporte-1', status: 'OPEN' })
    );
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({
        status: 'CORRECTION',
        assignedToSoporteId: 'soporte-1',
        assignedToSoporte: { id: 'soporte-1', name: 'Soporte Uno' },
      })
    );

    await updateStatus('ticket-1', SOPORTE, 'CORRECTION');

    const datos = prismaMock.ticket.update.mock.calls[0][0].data;
    expect(datos.assignedToSoporteId).toBe('soporte-1');
    expect(datos.comments.create.content).toBe('Cambio de estado → En corrección');
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:updated',
      expect.objectContaining({
        triggeredBy: expect.objectContaining({ name: 'Soporte Uno' }),
      })
    );
  });

  it('lanza TICKET_NOT_FOUND cuando el ticket no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateStatus('ticket-404', SOPORTE, 'ANALYSIS'), {
      status: 404,
      code: 'TICKET_NOT_FOUND',
    });
  });

  it('lanza FORBIDDEN_STATUS cuando el actor no es soporte', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());

    await expectApiError(() => updateStatus('ticket-1', ADMIN, 'ANALYSIS'), {
      status: 403,
      code: 'FORBIDDEN_STATUS',
      message: 'Solo el personal de soporte puede cambiar el estado del ticket',
    });
    expect(prismaMock.ticket.update).not.toHaveBeenCalled();
  });

  it('lanza INVALID_TICKET_STATE cuando el ticket está cerrado', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'CLOSED' }));

    await expectApiError(() => updateStatus('ticket-1', SOPORTE, 'ANALYSIS'), {
      status: 400,
      code: 'INVALID_TICKET_STATE',
    });
  });

  it('lanza INVALID_TICKET_STATE cuando el ticket fue rechazado', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'REJECTED' }));

    await expectApiError(() => updateStatus('ticket-1', SOPORTE, 'ANALYSIS'), {
      status: 400,
      code: 'INVALID_TICKET_STATE',
    });
  });

  it('lanza INVALID_STATUS_TRANSITION al intentar pasar a SOLVED por esta vía', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());

    await expectApiError(() => updateStatus('ticket-1', SOPORTE, 'SOLVED'), {
      status: 400,
      code: 'INVALID_STATUS_TRANSITION',
      message: 'Estado inválido: use SOLVED para resolver con evidencia',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// addComment
// ───────────────────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('permite comentar a soporte de otra tienda y notifica el comentario', async () => {
    prismaMock.ticket.findUnique
      .mockResolvedValueOnce(ticketBase())
      .mockResolvedValue(ticketDetalle());
    prismaMock.ticketComment.create.mockResolvedValue({
      id: 'com-1',
      content: 'Estamos revisando',
      user: usuarioTicket({ id: 'soporte-1', name: 'Soporte Uno', role: 'SOPORTE' }),
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'soporte-1',
      name: 'Soporte Uno',
      role: 'SOPORTE',
    });

    const resultado = await addComment('ticket-1', SOPORTE, 'Estamos revisando');

    expect(prismaMock.ticketComment.create).toHaveBeenCalledWith({
      data: { ticketId: 'ticket-1', userId: 'soporte-1', content: 'Estamos revisando' },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    expect(resultado).toMatchObject({ id: 'ticket-1' });
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:comment_added',
      expect.objectContaining({
        comment: { id: 'com-1', content: 'Estamos revisando', authorName: 'Soporte Uno' },
      })
    );
  });

  it('permite comentar a un ADMIN de la misma tienda aunque no exista el autor al notificar', async () => {
    prismaMock.ticket.findUnique
      .mockResolvedValueOnce(ticketBase())
      .mockResolvedValue(ticketDetalle());
    prismaMock.ticketComment.create.mockResolvedValue({
      id: 'com-2',
      content: 'Dato adicional',
      user: usuarioTicket({ id: 'admin-1', name: 'Admin', role: 'ADMIN' }),
    });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await addComment('ticket-1', ADMIN, 'Dato adicional');

    expect(prismaMock.ticketComment.create).toHaveBeenCalled();
    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('permite comentar a un GERENTE de la misma tienda', async () => {
    prismaMock.ticket.findUnique
      .mockResolvedValueOnce(ticketBase())
      .mockResolvedValue(ticketDetalle());
    prismaMock.ticketComment.create.mockResolvedValue({
      id: 'com-3',
      content: 'Seguimiento',
      user: usuarioTicket({ id: 'gerente-1', name: 'Gerente', role: 'GERENTE' }),
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'gerente-1',
      name: 'Gerente',
      role: 'GERENTE',
    });

    await addComment(
      'ticket-1',
      { id: 'gerente-1', role: 'GERENTE', storeId: 'store-1' },
      'Seguimiento'
    );

    expect(prismaMock.ticketComment.create).toHaveBeenCalled();
    expect(emitToStore).toHaveBeenCalled();
  });

  it('lanza TICKET_NOT_FOUND cuando el ticket no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expectApiError(() => addComment('ticket-404', ADMIN, 'hola'), {
      status: 404,
      code: 'TICKET_NOT_FOUND',
    });
  });

  it('lanza FORBIDDEN_COMMENT a un vendedor de la tienda', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());

    await expectApiError(
      () => addComment('ticket-1', { id: 'user-1', role: 'VENDEDOR', storeId: 'store-1' }, 'hola'),
      {
        status: 403,
        code: 'FORBIDDEN_COMMENT',
        message: 'No tienes permiso para comentar este ticket',
      }
    );
  });

  it('lanza FORBIDDEN_COMMENT a un ADMIN de otra tienda', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());

    await expectApiError(
      () => addComment('ticket-1', { id: 'admin-2', role: 'ADMIN', storeId: 'store-2' }, 'hola'),
      { status: 403, code: 'FORBIDDEN_COMMENT' }
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// solveTicket
// ───────────────────────────────────────────────────────────────────────────

describe('solveTicket', () => {
  it('marca SOLVED con evidencia y comentario de solución', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({
        status: 'SOLVED',
        solutionEvidence: 'ZXZpZGVuY2lh',
        solutionComment: 'Se reinició el servicio',
        assignedToSoporteId: 'soporte-1',
        assignedToSoporte: { id: 'soporte-1', name: 'Soporte Uno' },
      })
    );

    const resultado = await solveTicket('ticket-1', SOPORTE, {
      solutionComment: 'Se reinició el servicio',
      solutionEvidence: {
        fileName: 'fix.png',
        mimeType: 'image/png',
        data: 'ZXZpZGVuY2lh',
      },
    });

    const datos = prismaMock.ticket.update.mock.calls[0][0].data;
    expect(datos).toMatchObject({
      status: 'SOLVED',
      assignedToSoporteId: 'soporte-1',
      solutionComment: 'Se reinició el servicio',
      solutionEvidence: 'ZXZpZGVuY2lh',
      solutionEvidenceFileName: 'fix.png',
      solutionEvidenceMimeType: 'image/png',
    });
    expect(datos.comments.create.content).toBe('🔒 Solución aplicada: Se reinició el servicio');
    expect(resultado).toMatchObject({ status: 'SOLVED' });
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:solved',
      expect.objectContaining({
        solutionComment: 'Se reinició el servicio',
        triggeredBy: expect.objectContaining({ name: 'Soporte Uno' }),
      })
    );
  });

  it('marca SOLVED sin comentario y con el nombre de soporte por defecto', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({
        status: 'SOLVED',
        solutionEvidence: 'ZXZpZGVuY2lh',
        assignedToSoporteId: 'soporte-1',
      })
    );

    await solveTicket('ticket-1', SOPORTE, {
      solutionEvidence: { fileName: 'fix.png', mimeType: 'image/png', data: 'ZXZpZGVuY2lh' },
    });

    const datos = prismaMock.ticket.update.mock.calls[0][0].data;
    expect(datos.solutionComment).toBeNull();
    expect(datos.comments.create.content).toBe('🔒 Ticket marcado como solucionado');
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:solved',
      expect.objectContaining({ triggeredBy: expect.objectContaining({ name: 'Soporte' }) })
    );
  });

  it('lanza FORBIDDEN_SOLVE cuando el actor no es soporte', async () => {
    await expectApiError(
      () =>
        solveTicket(
          'ticket-1',
          ADMIN,
          { solutionEvidence: { fileName: 'a.png', mimeType: 'image/png', data: 'x' } },
        ),
      {
        status: 403,
        code: 'FORBIDDEN_SOLVE',
        message: 'Solo el personal de soporte puede marcar tickets como solucionados',
      }
    );
    expect(prismaMock.ticket.findUnique).not.toHaveBeenCalled();
  });

  it('lanza TICKET_NOT_FOUND cuando el ticket no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expectApiError(
      () =>
        solveTicket('ticket-404', SOPORTE, {
          solutionEvidence: { fileName: 'a.png', mimeType: 'image/png', data: 'x' },
        }),
      { status: 404, code: 'TICKET_NOT_FOUND' }
    );
  });

  it('lanza INVALID_TICKET_STATE cuando el ticket está cerrado', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'CLOSED' }));

    await expectApiError(
      () =>
        solveTicket('ticket-1', SOPORTE, {
          solutionEvidence: { fileName: 'a.png', mimeType: 'image/png', data: 'x' },
        }),
      { status: 400, code: 'INVALID_TICKET_STATE' }
    );
  });

  it('lanza INVALID_TICKET_STATE cuando el ticket fue rechazado', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'REJECTED' }));

    await expectApiError(
      () =>
        solveTicket('ticket-1', SOPORTE, {
          solutionEvidence: { fileName: 'a.png', mimeType: 'image/png', data: 'x' },
        }),
      { status: 400, code: 'INVALID_TICKET_STATE' }
    );
  });

  it('lanza EVIDENCE_REQUIRED cuando no se adjunta evidencia', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase());

    await expectApiError(() => solveTicket('ticket-1', SOPORTE, {}), {
      status: 400,
      code: 'EVIDENCE_REQUIRED',
      message: 'La evidencia de solución es requerida para cerrar el ticket',
    });
    expect(prismaMock.ticket.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// closeTicket
// ───────────────────────────────────────────────────────────────────────────

describe('closeTicket', () => {
  it('cierra un ticket SOLVED con calificación y comentario', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({ status: 'CLOSED', rating: 5, ratingComment: 'Muy rápido' })
    );
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      name: 'Admin',
      role: 'ADMIN',
    });

    const resultado = await closeTicket('ticket-1', ADMIN, {
      rating: 5,
      ratingComment: 'Muy rápido',
    });

    const datos = prismaMock.ticket.update.mock.calls[0][0].data;
    expect(datos).toMatchObject({ status: 'CLOSED', rating: 5, ratingComment: 'Muy rápido' });
    expect(datos.comments.create.content).toBe(
      '✅ Ticket cerrado con calificación 5/5: Muy rápido'
    );
    expect(resultado).toMatchObject({ status: 'CLOSED', rating: 5 });
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:closed',
      expect.objectContaining({ rating: 5, ratingComment: 'Muy rápido' })
    );
  });

  it('cierra sin comentario y usa rating 0 en el evento si el registro no lo devuelve', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({ status: 'CLOSED', rating: null })
    );
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-1', name: 'Admin', role: 'ADMIN' });

    await closeTicket('ticket-1', ADMIN, { rating: 3 });

    const datos = prismaMock.ticket.update.mock.calls[0][0].data;
    expect(datos.ratingComment).toBeNull();
    expect(datos.comments.create.content).toBe('✅ Ticket cerrado con calificación 3/5');
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:closed',
      expect.objectContaining({ rating: 0, ratingComment: null })
    );
  });

  it('no emite evento si el usuario que cierra no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));
    prismaMock.ticket.update.mockResolvedValue(ticketConRelaciones({ status: 'CLOSED', rating: 4 }));
    prismaMock.user.findUnique.mockResolvedValue(null);

    await closeTicket('ticket-1', ADMIN, { rating: 4 });

    expect(prismaMock.ticket.update).toHaveBeenCalled();
    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('lanza TICKET_NOT_FOUND cuando el ticket no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expectApiError(() => closeTicket('ticket-404', ADMIN, { rating: 5 }), {
      status: 404,
      code: 'TICKET_NOT_FOUND',
    });
  });

  it('lanza FORBIDDEN_CLOSE cuando el actor es soporte', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));

    await expectApiError(() => closeTicket('ticket-1', SOPORTE, { rating: 5 }), {
      status: 403,
      code: 'FORBIDDEN_CLOSE',
      message: 'El personal de soporte no puede cerrar el ticket; debe ser el cliente',
    });
  });

  it('lanza FORBIDDEN_TICKET cuando el ticket es de otra tienda', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(
      ticketBase({ status: 'SOLVED', storeId: 'store-2' })
    );

    await expectApiError(() => closeTicket('ticket-1', ADMIN, { rating: 5 }), {
      status: 403,
      code: 'FORBIDDEN_TICKET',
      message: 'No tienes permiso sobre este ticket',
    });
  });

  it('lanza INVALID_TICKET_STATE cuando el ticket no está SOLVED', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'OPEN' }));

    await expectApiError(() => closeTicket('ticket-1', ADMIN, { rating: 5 }), {
      status: 400,
      code: 'INVALID_TICKET_STATE',
      message: 'Solo se pueden cerrar tickets en estado SOLVED',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// rejectTicket
// ───────────────────────────────────────────────────────────────────────────

describe('rejectTicket', () => {
  it('rechaza el cierre, limpia la evidencia y regresa el ticket a análisis', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({ status: 'ANALYSIS', rejectReason: 'No resuelve el problema' })
    );
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'Vendedor', role: 'VENDEDOR' });

    const resultado = await rejectTicket(
      'ticket-1',
      { id: 'user-1', role: 'VENDEDOR', storeId: 'store-1' },
      { rejectReason: 'No resuelve el problema' }
    );

    expect(prismaMock.ticket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: {
        status: 'ANALYSIS',
        rejectReason: 'No resuelve el problema',
        solutionEvidence: null,
        solutionEvidenceFileName: null,
        solutionEvidenceMimeType: null,
        solutionComment: null,
        comments: {
          create: {
            userId: 'user-1',
            content: 'Cierre rechazado: No resuelve el problema',
          },
        },
      },
      include: expect.objectContaining({ user: expect.any(Object) }),
    });
    expect(resultado).toMatchObject({ status: 'ANALYSIS' });
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:rejected',
      expect.objectContaining({ rejectReason: 'No resuelve el problema' })
    );
  });

  it('usa cadena vacía en el evento cuando el ticket no trae motivo', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({ status: 'ANALYSIS', rejectReason: null })
    );
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-1', name: 'Admin', role: 'ADMIN' });

    await rejectTicket('ticket-1', ADMIN, { rejectReason: 'Incompleto' });

    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'ticket:rejected',
      expect.objectContaining({ rejectReason: '' })
    );
  });

  it('no emite evento si el usuario que rechaza no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));
    prismaMock.ticket.update.mockResolvedValue(
      ticketConRelaciones({ status: 'ANALYSIS', rejectReason: 'Incompleto' })
    );
    prismaMock.user.findUnique.mockResolvedValue(null);

    await rejectTicket('ticket-1', ADMIN, { rejectReason: 'Incompleto' });

    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('lanza TICKET_NOT_FOUND cuando el ticket no existe', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expectApiError(() => rejectTicket('ticket-404', ADMIN, { rejectReason: 'x' }), {
      status: 404,
      code: 'TICKET_NOT_FOUND',
    });
  });

  it('lanza FORBIDDEN_REJECT cuando el actor es soporte', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'SOLVED' }));

    await expectApiError(() => rejectTicket('ticket-1', SOPORTE, { rejectReason: 'x' }), {
      status: 403,
      code: 'FORBIDDEN_REJECT',
      message: 'El personal de soporte no puede rechazar el cierre',
    });
  });

  it('lanza FORBIDDEN_TICKET cuando el ticket es de otra tienda', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(
      ticketBase({ status: 'SOLVED', storeId: 'store-2' })
    );

    await expectApiError(() => rejectTicket('ticket-1', ADMIN, { rejectReason: 'x' }), {
      status: 403,
      code: 'FORBIDDEN_TICKET',
    });
  });

  it('lanza INVALID_TICKET_STATE cuando el ticket no está SOLVED', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(ticketBase({ status: 'ANALYSIS' }));

    await expectApiError(() => rejectTicket('ticket-1', ADMIN, { rejectReason: 'x' }), {
      status: 400,
      code: 'INVALID_TICKET_STATE',
      message: 'Solo se pueden rechazar cierres de tickets en estado SOLVED',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getTicketConfig / updateTicketConfig
// ───────────────────────────────────────────────────────────────────────────

describe('getTicketConfig', () => {
  it('devuelve la configuración con la tienda incluida', async () => {
    const config = {
      storeId: 'store-1',
      soporteUserId: 'soporte-1',
      store: { id: 'store-1', name: 'Abarrotes Servicaja', code: 'STORE001' },
    };
    prismaMock.ticketConfig.findUnique.mockResolvedValue(config);

    const resultado = await getTicketConfig('store-1');

    expect(prismaMock.ticketConfig.findUnique).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      include: { store: { select: { id: true, name: true, code: true } } },
    });
    expect(resultado).toBe(config);
  });

  it('devuelve null cuando la tienda no tiene configuración', async () => {
    prismaMock.ticketConfig.findUnique.mockResolvedValue(null);

    await expect(getTicketConfig('store-404')).resolves.toBeNull();
  });
});

describe('updateTicketConfig', () => {
  it('guarda el usuario SOPORTE activo indicado', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'soporte-1',
      role: 'SOPORTE',
      isActive: true,
    });
    prismaMock.ticketConfig.upsert.mockResolvedValue({
      storeId: 'store-1',
      soporteUserId: 'soporte-1',
    });

    const resultado = await updateTicketConfig('store-1', 'soporte-1');

    expect(prismaMock.ticketConfig.upsert).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      create: { storeId: 'store-1', soporteUserId: 'soporte-1' },
      update: { soporteUserId: 'soporte-1' },
    });
    expect(resultado).toMatchObject({ soporteUserId: 'soporte-1' });
  });

  it('limpia la asignación cuando no se indica usuario de soporte', async () => {
    prismaMock.ticketConfig.upsert.mockResolvedValue({
      storeId: 'store-1',
      soporteUserId: null,
    });

    await updateTicketConfig('store-1', null);

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.ticketConfig.upsert).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      create: { storeId: 'store-1', soporteUserId: null },
      update: { soporteUserId: null },
    });
  });

  it('lanza USER_NOT_FOUND cuando el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateTicketConfig('store-1', 'soporte-404'), {
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'Usuario de soporte no encontrado',
    });
    expect(prismaMock.ticketConfig.upsert).not.toHaveBeenCalled();
  });

  it('lanza INVALID_ROLE cuando el usuario no es SOPORTE', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'VENDEDOR',
      isActive: true,
    });

    await expectApiError(() => updateTicketConfig('store-1', 'user-1'), {
      status: 400,
      code: 'INVALID_ROLE',
      message: 'El usuario asignado debe tener rol SOPORTE',
    });
  });

  it('lanza USER_INACTIVE cuando el usuario de soporte está inactivo', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'soporte-1',
      role: 'SOPORTE',
      isActive: false,
    });

    await expectApiError(() => updateTicketConfig('store-1', 'soporte-1'), {
      status: 400,
      code: 'USER_INACTIVE',
      message: 'El usuario de soporte está inactivo',
    });
  });
});
