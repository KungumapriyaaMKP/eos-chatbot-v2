import { prisma } from '../utils/prisma';
import { verifyPassword } from '../utils/password';
import { signChatbotToken } from './jwt.util';
import { AppError } from '../utils/http-error';
import { logger } from '../utils/logger';
import type { JwtPayload } from './jwt-payload.interface';

export interface LoginResult {
  accessToken: string;
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
    roleId: number;
  };
}

/**
 * TEMPORARY chatbot login.
 *
 * Verifies credentials against the EXISTING `users`/`roles` tables in the
 * shared EOS database, using the exact same password hashing scheme as
 * EOS-backend's own AuthService (see src/utils/password.ts). No new user,
 * no new table, no new credential store — this only issues a *separate*
 * chatbot-scoped JWT so the chatbot can be exercised standalone before the
 * real ERP frontend wires up its own session.
 *
 * See src/auth/README.md for removal instructions once that happens.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.users.findUnique({
    where: { email },
    include: {
      roles: true,
      faculty: { select: { first_name: true, last_name: true } },
      students: {
        select: {
          student_id_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
        },
      },
    },
  });

  if (!user) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    throw AppError.forbidden('Account is inactive. Contact administrator.', 'ACCOUNT_INACTIVE');
  }

  if (!verifyPassword(password, user.password_hash)) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const name = resolveDisplayName(user);

  const payload: JwtPayload = {
    sub: user.id,
    name,
    role: user.roles.name,
    roleId: user.roles.id,
    email: user.email,
  };

  const accessToken = signChatbotToken(payload);

  logger.log('auth', `${user.email} (role: ${user.roles.name}) logged in to the chatbot`);

  return {
    accessToken,
    user: { id: user.id, name, email: user.email, role: user.roles.name, roleId: user.roles.id },
  };
}

function resolveDisplayName(user: {
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  students: {
    student_id_no: string;
    soa_applications: { first_name: string; last_name: string | null } | null;
  } | null;
}): string {
  if (user.faculty) {
    return `${user.faculty.first_name} ${user.faculty.last_name}`.trim();
  }
  if (user.students?.soa_applications) {
    const { first_name, last_name } = user.students.soa_applications;
    return [first_name, last_name].filter(Boolean).join(' ');
  }
  if (user.students) {
    return user.students.student_id_no;
  }
  // Admin / HOD / other staff roles with no faculty row, or a student row
  // with no linked soa_applications — fall back to the email's local part.
  return user.email.split('@')[0];
}
