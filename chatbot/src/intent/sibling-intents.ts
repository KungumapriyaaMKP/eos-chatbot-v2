/**
 * A narrow, explicit, hand-curated list of intent pairs that ask the
 * literal SAME real-world question, just scoped to a different role —
 * "check my leave application" is textually identical whether a student
 * or a faculty member types it, and the classifier only ever sees the
 * text, never the caller's role. No amount of training data can fully
 * separate two intents whose phrasing genuinely overlaps this much (see
 * scripts/audit-classifier-consistency.ts — get_leave_status and
 * faculty_leave_status kept swapping at confidence 0.9+ even after
 * targeted anchor examples).
 *
 * chat.controller.ts consults this ONLY as a fallback, after RBAC has
 * already denied the classifier's top pick: if a listed sibling intent
 * DOES allow the caller's role, silently route there instead of denying.
 * This deliberately does NOT touch classification or confidence at all —
 * a wrong pick between true siblings costs nothing, because whichever
 * intent the caller's real role owns still returns their real data.
 *
 * Deliberately NOT a general "did you mean" or fuzzy-intent-matching
 * mechanism — only pairs listed here, each added by a human who's
 * confirmed the two intents really are the same question from two
 * vantage points (not just "semantically similar", which is true of many
 * unrelated intent pairs and would make this a security hole if applied
 * broadly: silently rerouting a genuinely-denied request to a DIFFERENT
 * real feature is only safe when that different feature answers the
 * exact same question the caller actually asked).
 */
export const SIBLING_INTENTS: Record<string, string[]> = {
  get_leave_status: ['faculty_leave_status'],
  faculty_leave_status: ['get_leave_status'],
  // "who teaches dbms" (faculty/hod/admin/coe asking institution-wide) vs
  // "which faculty teaches me dbms" (student/parent asking about their own
  // class) are the same underlying question with near-identical phrasing —
  // get_faculty_by_subject and get_mentor's subject-teacher branch answer
  // it from each side. Real gap found live: activating
  // get_faculty_by_subject's training examples pulled some
  // personally-framed ("teaches me") student phrasing away from get_mentor
  // toward it, and get_faculty_by_subject's roles (admin/hod/faculty/coe)
  // don't include student/parent — without this pairing that would have
  // been a flat, wrong permission denial instead of the real answer.
  get_faculty_by_subject: ['get_mentor'],
  get_mentor: ['get_faculty_by_subject'],
};
