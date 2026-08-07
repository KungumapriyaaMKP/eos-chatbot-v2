/**
 * Mirrors src/common/constants/roles.constant.ts in EOS-backend — these
 * strings must stay identical to the `roles.name` column values in the
 * shared database. The chatbot never invents its own role vocabulary.
 *
 * The intent training dataset only ever assigns intents to student /
 * faculty / admin, so those are the three roles the chatbot's RBAC map
 * actually references — but every backend role is listed here so a
 * default-deny check against "unknown role" is never ambiguous.
 */
export const ROLES = {
  ADMIN: 'admin',
  HOD: 'hod',
  FACULTY: 'faculty',
  STUDENT: 'student',
  PARENT: 'parent',
  COE: 'coe',
  PLACEMENT: 'placement',
  LIBRARY: 'library',
  BILLING: 'billing',
  HR_PAYROLL: 'hr_payroll',
  FINANCE: 'finance',
  IQAC: 'iqac',
  SECRETARY: 'secretary',
  GATE_WARDEN: 'gate_warden',
  MEDIA_ROOM: 'media_room',
  ACADEMIC_COORDINATOR: 'academic_coordinator',
  ALUMNI: 'alumni',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

/** The three roles the intent dataset was authored against. */
export const DATASET_ROLE_MAP: Record<string, RoleKey> = {
  student: ROLES.STUDENT,
  faculty: ROLES.FACULTY,
  admin: ROLES.ADMIN,
};
