import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { calcularCorte } from './cajaSession.service';
import { audit } from '../utils/audit';
import { mexicoLocalDateKey } from '../utils/dates';

async function getSystemUserId(storeId: string): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { storeId, role: 'ADMIN', isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (admin) return admin.id;
  const anyUser = await prisma.user.findFirst({
    where: { storeId, isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!anyUser) throw new Error('No active user found for store');
  return anyUser.id;
}

export async function autoCloseStoreSessions(storeId: string): Promise<{ closed: number }> {
  const systemUserId = await getSystemUserId(storeId);
  const today = mexicoLocalDateKey(new Date());

  const openSessions = await prisma.cajaSession.findMany({
    where: { storeId, status: 'OPEN', openingDate: today },
    include: { caja: true },
  });

  let closedCount = 0;

  for (const session of openSessions) {
    const cut = await calcularCorte(session, storeId);

    await prisma.$transaction(async (tx) => {
      const closedAt = new Date();

      await tx.cajaSession.update({
        where: { id: session.id },
        data: {
          status: 'CLOSED',
          closedAt,
          closingDate: session.openingDate,
          closedBy: systemUserId,
          closingCash: cut.expectedCash,
          closingElectronic: cut.expectedElectronic,
          closingNote: 'Cierre automático',
          salesCash: cut.salesCash,
          salesElectronic: cut.salesElectronic,
          purchasesCash: cut.purchasesCash,
          purchasesElectronic: cut.purchasesElectronic,
          expectedCash: cut.expectedCash,
          expectedElectronic: cut.expectedElectronic,
          diffCash: new Prisma.Decimal(0),
          diffElectronic: new Prisma.Decimal(0),
        },
      });

      await audit({
        storeId,
        userId: systemUserId,
        action: 'AUTO_CLOSE_CAJA',
        entity: 'CajaSession',
        entityId: session.id,
        metadata: {
          cajaId: session.cajaId,
          expectedCash: cut.expectedCash.toString(),
          expectedElectronic: cut.expectedElectronic.toString(),
        },
      });
    });

    closedCount++;
  }

  return { closed: closedCount };
}

export function buildCronExpression(time: string, days: string[]): string {
  const [hours, minutes] = time.split(':').map(Number);
  const dayNums = days.map((d) => parseInt(d, 10)).sort((a, b) => a - b).join(',');
  return `${minutes} ${hours} * * ${dayNums}`;
}