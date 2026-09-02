import { prisma } from '../config/prisma';
import { Prisma, TicketStatus, Role } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { logger } from '../config/logger';

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]: 'Abierto',
  [TicketStatus.ANALYSIS]: 'En análisis',
  [TicketStatus.REVIEW]: 'En revisión',
  [TicketStatus.CORRECTION]: 'En corrección',
  [TicketStatus.SOLVED]: 'Solucionado',
  [TicketStatus.CLOSED]: 'Cerrado',
  [TicketStatus.REJECTED]: 'Rechazado',
};

export interface CreateTicketInput {
  ticketModule: string;
  subject: string;
  description: string;
  priority?: string;
  attachment?: {
    fileName: string;
    mimeType: string;
    data: string;
  } | null;
}

export interface AddCommentInput {
  content: string;
}

export interface SolveTicketInput {
  solutionComment?: string | null;
  solutionEvidence?: {
    fileName: string;
    mimeType: string;
    data: string;
  } | null;
}

export interface CloseTicketInput {
  rating: number;
  ratingComment?: string | null;
}

export interface RejectTicketInput {
  rejectReason: string;
}

export interface ListTicketsQuery {
  status?: string;
  ticketModule?: string;
  priority?: string;
  storeId?: string;
  assignedToSoporteId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

const TICKET_INCLUDE = {
  user: { select: { id: true, name: true, email: true, role: true } },
  assignedToSoporte: { select: { id: true, name: true, email: true } },
  store: { select: { id: true, name: true, code: true } },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, createdAt: true },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.TicketInclude;

type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

function serializeTicket(ticket: TicketWithRelations) {
  return {
    id: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    store: ticket.store,
    userId: ticket.userId,
    user: ticket.user,
    assignedToSoporteId: ticket.assignedToSoporteId,
    assignedToSoporte: ticket.assignedToSoporte,
    ticketModule: ticket.ticketModule,
    subject: ticket.subject,
    description: ticket.description,
    priority: ticket.priority,
    status: ticket.status,
    solutionEvidence: ticket.solutionEvidence,
    solutionComment: ticket.solutionComment,
    rating: ticket.rating,
    ratingComment: ticket.ratingComment,
    rejectReason: ticket.rejectReason,
    hasEvidence: Boolean(ticket.solutionEvidence),
    attachments: ticket.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      createdAt: a.createdAt.toISOString(),
    })),
    commentCount: ticket._count.comments,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

const TICKET_DETAIL_INCLUDE = {
  user: { select: { id: true, name: true, email: true, role: true } },
  assignedToSoporte: { select: { id: true, name: true, email: true } },
  store: { select: { id: true, name: true, code: true } },
  attachments: true,
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  },
} satisfies Prisma.TicketInclude;

type TicketDetailWithRelations = Prisma.TicketGetPayload<{
  include: typeof TICKET_DETAIL_INCLUDE;
}>;

function serializeTicketDetail(ticket: TicketDetailWithRelations) {
  return {
    id: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    store: ticket.store,
    userId: ticket.userId,
    user: ticket.user,
    assignedToSoporteId: ticket.assignedToSoporteId,
    assignedToSoporte: ticket.assignedToSoporte,
    ticketModule: ticket.ticketModule,
    subject: ticket.subject,
    description: ticket.description,
    priority: ticket.priority,
    status: ticket.status,
    solutionEvidence: ticket.solutionEvidence,
    solutionComment: ticket.solutionComment,
    rating: ticket.rating,
    ratingComment: ticket.ratingComment,
    rejectReason: ticket.rejectReason,
    hasEvidence: Boolean(ticket.solutionEvidence),
    attachments: ticket.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      data: a.data,
      createdAt: a.createdAt.toISOString(),
    })),
    comments: ticket.comments.map((c) => ({
      id: c.id,
      content: c.content,
      user: c.user,
      createdAt: c.createdAt.toISOString(),
    })),
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

async function generateTicketFolio(storeId: string): Promise<string> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { code: true },
  });
  if (!store) {
    throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');
  }

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: { ticketSequence: { increment: 1 } },
    select: { ticketSequence: true },
  });

  const seq = updated.ticketSequence.toString().padStart(4, '0');
  return `TICKET-${store.code}-${seq}`;
}

export async function createTicket(
  storeId: string,
  userId: string,
  input: CreateTicketInput
) {
  // Auto-asignar al soporte configurado en la tienda si existe.
  const config = await prisma.ticketConfig.findUnique({ where: { storeId } });

  const folio = await generateTicketFolio(storeId);

  const ticket = await prisma.ticket.create({
    data: {
      folio,
      storeId,
      userId,
      ticketModule: input.ticketModule as Prisma.TicketCreateInput['ticketModule'],
      subject: input.subject,
      description: input.description,
      priority: (input.priority as Prisma.TicketCreateInput['priority']) ?? 'MEDIUM',
      status: TicketStatus.OPEN,
      assignedToSoporteId: config?.soporteUserId ?? null,
      attachments: input.attachment
        ? {
            create: {
              fileName: input.attachment.fileName,
              mimeType: input.attachment.mimeType,
              data: input.attachment.data,
            },
          }
        : undefined,
    },
    include: TICKET_INCLUDE,
  });

  logger.info(
    `Ticket creado: ${ticket.folio} por usuario ${userId} en tienda ${storeId}`
  );

  return serializeTicket(ticket);
}

export async function listTickets(
  actorRole: string,
  actorStoreId: string,
  _actorId: string,
  query: ListTicketsQuery
) {
  const where: Prisma.TicketWhereInput = {};

  // SOPORTE ve todos los tickets; los demás ven solo los de su tienda.
  if (actorRole !== Role.SOPORTE) {
    where.storeId = actorStoreId;
  } else if (query.storeId) {
    where.storeId = query.storeId;
  }

  if (query.status) where.status = query.status as TicketStatus;
  if (query.ticketModule) where.ticketModule = query.ticketModule as Prisma.TicketWhereInput['ticketModule'];
  if (query.priority) where.priority = query.priority as Prisma.TicketWhereInput['priority'];
  if (query.assignedToSoporteId) where.assignedToSoporteId = query.assignedToSoporteId;
  if (query.search) {
    where.OR = [
      { folio: { contains: query.search, mode: 'insensitive' } },
      { subject: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) {
      (where.createdAt as Prisma.DateTimeFilter).gte = new Date(`${query.startDate}T00:00:00.000Z`);
    }
    if (query.endDate) {
      (where.createdAt as Prisma.DateTimeFilter).lte = new Date(`${query.endDate}T23:59:59.999Z`);
    }
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: TICKET_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return tickets.map(serializeTicket);
}

export async function getTicket(
  ticketId: string,
  actorRole: string,
  actorStoreId: string
) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: TICKET_DETAIL_INCLUDE,
  });
  if (!ticket) {
    throw ApiError.notFound('Ticket no encontrado', 'TICKET_NOT_FOUND');
  }

  // Permisos: SOPORTE ve cualquier ticket; los demás solo los de su tienda.
  if (actorRole !== Role.SOPORTE && ticket.storeId !== actorStoreId) {
    throw ApiError.forbidden('No tienes permiso para ver este ticket', 'FORBIDDEN_TICKET');
  }

  return serializeTicketDetail(ticket);
}

export async function updateStatus(
  ticketId: string,
  actor: { id: string; role: string; storeId: string },
  status: string,
  comment?: string | null
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    throw ApiError.notFound('Ticket no encontrado', 'TICKET_NOT_FOUND');
  }

  // Solo SOPORTE puede mover entre estados durante la atención.
  if (actor.role !== Role.SOPORTE) {
    throw ApiError.forbidden(
      'Solo el personal de soporte puede cambiar el estado del ticket',
      'FORBIDDEN_STATUS'
    );
  }

  if (ticket.status === TicketStatus.CLOSED || ticket.status === TicketStatus.REJECTED) {
    throw ApiError.badRequest(
      'El ticket ya está cerrado/rechazado y no puede cambiar de estado',
      'INVALID_TICKET_STATE'
    );
  }

  const nextStatus = status as TicketStatus;
  const allowedFromOpen: TicketStatus[] = [
    TicketStatus.OPEN,
    TicketStatus.ANALYSIS,
    TicketStatus.REVIEW,
    TicketStatus.CORRECTION,
  ];
  if (!allowedFromOpen.includes(nextStatus)) {
    throw ApiError.badRequest(
      'Estado inválido: use SOLVED para resolver con evidencia',
      'INVALID_STATUS_TRANSITION'
    );
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: nextStatus,
      // Auto-asignar al soporte que mueve el ticket si aún está sin asignar.
      assignedToSoporteId: ticket.assignedToSoporteId ?? actor.id,
      // Registrar el cambio de estado en el hilo de actividad, con o sin
      // comentario. Esto asegura que el timeline siempre refleje qué pasó.
      comments: {
        create: {
          userId: actor.id,
          content: comment
            ? `Cambio de estado → ${TICKET_STATUS_LABELS[nextStatus]}: ${comment}`
            : `Cambio de estado → ${TICKET_STATUS_LABELS[nextStatus]}`,
        },
      },
    },
    include: TICKET_INCLUDE,
  });

  logger.info(
    `Ticket ${ticket.folio} cambió a ${nextStatus} por soporte ${actor.id}`
  );

  return serializeTicket(updated);
}

export async function addComment(
  ticketId: string,
  actor: { id: string; role: string; storeId: string },
  content: string
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    throw ApiError.notFound('Ticket no encontrado', 'TICKET_NOT_FOUND');
  }

  const canComment =
    actor.role === Role.SOPORTE ||
    (ticket.storeId === actor.storeId &&
      (actor.role === Role.ADMIN || actor.role === Role.GERENTE));
  if (!canComment) {
    throw ApiError.forbidden(
      'No tienes permiso para comentar este ticket',
      'FORBIDDEN_COMMENT'
    );
  }

  await prisma.ticketComment.create({
    data: {
      ticketId,
      userId: actor.id,
      content,
    },
  });

  return getTicket(ticketId, actor.role, actor.storeId);
}

export async function solveTicket(
  ticketId: string,
  actor: { id: string; role: string; storeId: string },
  input: SolveTicketInput
) {
  if (actor.role !== Role.SOPORTE) {
    throw ApiError.forbidden(
      'Solo el personal de soporte puede marcar tickets como solucionados',
      'FORBIDDEN_SOLVE'
    );
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    throw ApiError.notFound('Ticket no encontrado', 'TICKET_NOT_FOUND');
  }

  if (ticket.status === TicketStatus.CLOSED || ticket.status === TicketStatus.REJECTED) {
    throw ApiError.badRequest(
      'El ticket ya está cerrado/rechazado',
      'INVALID_TICKET_STATE'
    );
  }

  if (!input.solutionEvidence) {
    throw ApiError.badRequest(
      'La evidencia de solución es requerida para cerrar el ticket',
      'EVIDENCE_REQUIRED'
    );
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: TicketStatus.SOLVED,
      assignedToSoporteId: ticket.assignedToSoporteId ?? actor.id,
      solutionComment: input.solutionComment ?? null,
      solutionEvidence: input.solutionEvidence.data,
      // Almacenamos metadatos de la evidencia como adjunto para descarga.
      attachments: {
        create: {
          fileName: input.solutionEvidence.fileName,
          mimeType: input.solutionEvidence.mimeType,
          data: input.solutionEvidence.data,
        },
      },
      // Registrar la solución como actividad en el hilo de comentarios.
      comments: {
        create: {
          userId: actor.id,
          content: input.solutionComment
            ? `✅ Solución aplicada: ${input.solutionComment}`
            : `✅ Ticket marcado como solucionado (evidencia: ${input.solutionEvidence.fileName})`,
        },
      },
    },
    include: TICKET_INCLUDE,
  });

  logger.info(`Ticket ${ticket.folio} marcado como SOLVED por soporte ${actor.id}`);

  return serializeTicket(updated);
}

export async function closeTicket(
  ticketId: string,
  actor: { id: string; role: string; storeId: string },
  input: CloseTicketInput
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    throw ApiError.notFound('Ticket no encontrado', 'TICKET_NOT_FOUND');
  }

  if (actor.role === Role.SOPORTE) {
    throw ApiError.forbidden(
      'El personal de soporte no puede cerrar el ticket; debe ser el cliente',
      'FORBIDDEN_CLOSE'
    );
  }
  if (ticket.storeId !== actor.storeId) {
    throw ApiError.forbidden('No tienes permiso sobre este ticket', 'FORBIDDEN_TICKET');
  }
  if (ticket.status !== TicketStatus.SOLVED) {
    throw ApiError.badRequest(
      'Solo se pueden cerrar tickets en estado SOLVED',
      'INVALID_TICKET_STATE'
    );
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: TicketStatus.CLOSED,
      rating: input.rating,
      ratingComment: input.ratingComment ?? null,
      // Registrar el cierre del ticket en el hilo de actividad.
      comments: {
        create: {
          userId: actor.id,
          content: input.ratingComment
            ? `✅ Ticket cerrado con calificación ${input.rating}/5: ${input.ratingComment}`
            : `✅ Ticket cerrado con calificación ${input.rating}/5`,
        },
      },
    },
    include: TICKET_INCLUDE,
  });

  logger.info(
    `Ticket ${ticket.folio} cerrado por cliente ${actor.id} con rating ${input.rating}`
  );

  return serializeTicket(updated);
}

export async function rejectTicket(
  ticketId: string,
  actor: { id: string; role: string; storeId: string },
  input: RejectTicketInput
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    throw ApiError.notFound('Ticket no encontrado', 'TICKET_NOT_FOUND');
  }

  if (actor.role === Role.SOPORTE) {
    throw ApiError.forbidden(
      'El personal de soporte no puede rechazar el cierre',
      'FORBIDDEN_REJECT'
    );
  }
  if (ticket.storeId !== actor.storeId) {
    throw ApiError.forbidden('No tienes permiso sobre este ticket', 'FORBIDDEN_TICKET');
  }
  if (ticket.status !== TicketStatus.SOLVED) {
    throw ApiError.badRequest(
      'Solo se pueden rechazar cierres de tickets en estado SOLVED',
      'INVALID_TICKET_STATE'
    );
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      // Al rechazar el cierre el ticket vuelve a análisis para que el soporte
      // continue trabajando.
      status: TicketStatus.ANALYSIS,
      rejectReason: input.rejectReason,
      // Limpiamos la evidencia previa para que soporte suba una nueva al
      // volver a marcar como SOLVED.
      solutionEvidence: null,
      solutionComment: null,
      comments: {
        create: {
          userId: actor.id,
          content: `Cierre rechazado: ${input.rejectReason}`,
        },
      },
    },
    include: TICKET_INCLUDE,
  });

  logger.info(`Ticket ${ticket.folio} rechazado por cliente ${actor.id}`);

  return serializeTicket(updated);
}

export async function getTicketConfig(storeId: string) {
  const config = await prisma.ticketConfig.findUnique({
    where: { storeId },
    include: { store: { select: { id: true, name: true, code: true } } },
  });
  return config;
}

export async function updateTicketConfig(
  storeId: string,
  soporteUserId: string | null
) {
  if (soporteUserId) {
    const soporte = await prisma.user.findUnique({
      where: { id: soporteUserId },
    });
    if (!soporte) {
      throw ApiError.notFound('Usuario de soporte no encontrado', 'USER_NOT_FOUND');
    }
    if (soporte.role !== Role.SOPORTE) {
      throw ApiError.badRequest(
        'El usuario asignado debe tener rol SOPORTE',
        'INVALID_ROLE'
      );
    }
    if (!soporte.isActive) {
      throw ApiError.badRequest(
        'El usuario de soporte está inactivo',
        'USER_INACTIVE'
      );
    }
  }

  const config = await prisma.ticketConfig.upsert({
    where: { storeId },
    create: { storeId, soporteUserId: soporteUserId ?? null },
    update: { soporteUserId: soporteUserId ?? null },
  });
  return config;
}
