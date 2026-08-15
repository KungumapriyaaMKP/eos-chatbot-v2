/**
 * Mirrors src/common/constants/roles.constant.ts in EOS-backend — these
 * strings must stay identical to the `roles.name` column values in the
 * shared database. The chatbot never invents its own role vocabulary.
 *
 * The intent training dataset currently assigns intents to 6 of these
 * roles (student, faculty, admin, hod, coe, parent — confirmed against the
 * live intents.json, not just this comment's word) — every backend role is
 * still listed here regardless, so a default-deny check against "unknown
 * role" is never ambiguous even for a role the dataset hasn't used yet.
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
