import { emitToStore, emitToStoreExcept } from './socket';

const TICKET_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Abierto',
  ANALYSIS: 'En análisis',
  REVIEW: 'En revisión',
  CORRECTION: 'En corrección',
  SOLVED: 'Solucionado',
  CLOSED: 'Cerrado',
  REJECTED: 'Rechazado',
};

export interface TicketEventPayload {
  ticketId: string;
  folio: string;
  storeId: string;
  subject: string;
  status: string;
  statusLabel: string;
  triggeredBy: {
    id: string;
    name: string;
    role: string;
  };
  at: string;
}

export interface TicketCreatedPayload extends TicketEventPayload {
  ticketModule: string;
  priority: string;
  assignedToSoporteId: string | null;
  assignedToSoporteName: string | null;
}

export interface TicketCommentPayload extends TicketEventPayload {
  comment: {
    id: string;
    content: string;
    authorName: string;
  };
}

export interface TicketSolvedPayload extends TicketEventPayload {
  solutionComment: string | null;
}

export interface TicketClosedPayload extends TicketEventPayload {
  rating: number;
  ratingComment: string | null;
}

export interface TicketRejectedPayload extends TicketEventPayload {
  rejectReason: string;
}

function buildBasePayload(
  ticket: {
    id: string;
    folio: string;
    storeId: string;
    subject: string;
    status: string;
  },
  triggeredBy: { id: string; name: string; role: string },
  exceptSocketId?: string | string[]
): TicketEventPayload {
  const base = {
    ticketId: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] ?? ticket.status,
    triggeredBy,
    at: new Date().toISOString(),
  };

  if (exceptSocketId !== undefined) {
    emitToStoreExcept(ticket.storeId, 'ticket:updated', base, exceptSocketId);
  } else {
    emitToStore(ticket.storeId, 'ticket:updated', base);
  }

  return base;
}

export function emitTicketCreated(
  ticket: {
    id: string;
    folio: string;
    storeId: string;
    subject: string;
    status: string;
    ticketModule: string;
    priority: string;
    assignedToSoporteId: string | null;
    assignedToSoporteName?: string | null;
  },
  triggeredBy: { id: string; name: string; role: string },
  exceptSocketId?: string | string[]
): TicketCreatedPayload {
  buildBasePayload(ticket, triggeredBy, exceptSocketId);

  const payload: TicketCreatedPayload = {
    ticketId: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] ?? ticket.status,
    ticketModule: ticket.ticketModule,
    priority: ticket.priority,
    assignedToSoporteId: ticket.assignedToSoporteId,
    assignedToSoporteName: ticket.assignedToSoporteName ?? null,
    triggeredBy,
    at: new Date().toISOString(),
  };

  const event = 'ticket:created';
  if (exceptSocketId !== undefined) {
    emitToStoreExcept(ticket.storeId, event, payload, exceptSocketId);
  } else {
    emitToStore(ticket.storeId, event, payload);
  }

  return payload;
}

export function emitTicketStatusChanged(
  ticket: {
    id: string;
    folio: string;
    storeId: string;
    subject: string;
    status: string;
  },
  triggeredBy: { id: string; name: string; role: string },
  exceptSocketId?: string | string[]
): TicketEventPayload {
  return buildBasePayload(
    { ...ticket, status: ticket.status },
    triggeredBy,
    exceptSocketId
  );
}

export function emitTicketCommentAdded(
  ticket: {
    id: string;
    folio: string;
    storeId: string;
    subject: string;
    status: string;
  },
  comment: { id: string; content: string; authorName: string },
  triggeredBy: { id: string; name: string; role: string },
  exceptSocketId?: string | string[]
): TicketCommentPayload {
  buildBasePayload(ticket, triggeredBy, exceptSocketId);

  const payload: TicketCommentPayload = {
    ticketId: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] ?? ticket.status,
    triggeredBy,
    comment,
    at: new Date().toISOString(),
  };

  const event = 'ticket:comment_added';
  if (exceptSocketId !== undefined) {
    emitToStoreExcept(ticket.storeId, event, payload, exceptSocketId);
  } else {
    emitToStore(ticket.storeId, event, payload);
  }

  return payload;
}

export function emitTicketSolved(
  ticket: {
    id: string;
    folio: string;
    storeId: string;
    subject: string;
    status: string;
    solutionComment: string | null;
  },
  triggeredBy: { id: string; name: string; role: string },
  exceptSocketId?: string | string[]
): TicketSolvedPayload {
  buildBasePayload(ticket, triggeredBy, exceptSocketId);

  const payload: TicketSolvedPayload = {
    ticketId: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] ?? ticket.status,
    solutionComment: ticket.solutionComment,
    triggeredBy,
    at: new Date().toISOString(),
  };

  const event = 'ticket:solved';
  if (exceptSocketId !== undefined) {
    emitToStoreExcept(ticket.storeId, event, payload, exceptSocketId);
  } else {
    emitToStore(ticket.storeId, event, payload);
  }

  return payload;
}

export function emitTicketClosed(
  ticket: {
    id: string;
    folio: string;
    storeId: string;
    subject: string;
    status: string;
    rating: number;
    ratingComment: string | null;
  },
  triggeredBy: { id: string; name: string; role: string },
  exceptSocketId?: string | string[]
): TicketClosedPayload {
  buildBasePayload(ticket, triggeredBy, exceptSocketId);

  const payload: TicketClosedPayload = {
    ticketId: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] ?? ticket.status,
    rating: ticket.rating,
    ratingComment: ticket.ratingComment,
    triggeredBy,
    at: new Date().toISOString(),
  };

  const event = 'ticket:closed';
  if (exceptSocketId !== undefined) {
    emitToStoreExcept(ticket.storeId, event, payload, exceptSocketId);
  } else {
    emitToStore(ticket.storeId, event, payload);
  }

  return payload;
}

export function emitTicketRejected(
  ticket: {
    id: string;
    folio: string;
    storeId: string;
    subject: string;
    status: string;
    rejectReason: string;
  },
  triggeredBy: { id: string; name: string; role: string },
  exceptSocketId?: string | string[]
): TicketRejectedPayload {
  buildBasePayload(ticket, triggeredBy, exceptSocketId);

  const payload: TicketRejectedPayload = {
    ticketId: ticket.id,
    folio: ticket.folio,
    storeId: ticket.storeId,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] ?? ticket.status,
    rejectReason: ticket.rejectReason,
    triggeredBy,
    at: new Date().toISOString(),
  };

  const event = 'ticket:rejected';
  if (exceptSocketId !== undefined) {
    emitToStoreExcept(ticket.storeId, event, payload, exceptSocketId);
  } else {
    emitToStore(ticket.storeId, event, payload);
  }

  return payload;
}
