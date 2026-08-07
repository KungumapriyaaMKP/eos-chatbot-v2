import { prisma } from '../utils/prisma';

export interface ResolvedFaculty {
  id: number;
  name: string;
  department_id: number;
}

/** A faculty member's own record, resolved from their JWT — never from the chat message. */
export async function resolveOwnFaculty(userId: number): Promise<ResolvedFaculty | null> {
  const row = await prisma.faculty.findUnique({
    where: { user_id: userId },
    select: { id: true, first_name: true, last_name: true, department_id: true },
  });
  if (!row) return null;
  return { id: row.id, name: `${row.first_name} ${row.last_name}`.trim(), department_id: row.department_id };
}
