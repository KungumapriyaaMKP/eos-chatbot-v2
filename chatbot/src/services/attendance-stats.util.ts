/**
 * Shared present/total/percentage computation for attendance_records rows.
 *
 * attendance_status_enum has 3 real values (present, absent, on_duty) —
 * on_duty is an OFFICIALLY EXCUSED absence (an approved on-duty activity:
 * sports, symposium, etc.), not stored anywhere as "counts toward
 * attendance" or not; there's no policy flag for it in this schema, same
 * situation as ASSUMED_SHORTAGE_THRESHOLD/ASSUMED_ELIGIBILITY_THRESHOLD
 * elsewhere in this codebase. Every caller here previously counted
 * on_duty records in the denominator without counting them in the
 * numerator either — silently identical to an unexcused absence. Confirmed
 * live impact: 11 of 102 records on-duty for one real class swung that
 * class's attendance percentage from 78.4% to 87.9%, a large enough gap to
 * flip an exam-eligibility outcome at the standard 75% threshold.
 *
 * ASSUMPTION (standard AICTE/most-Indian-university convention, not a
 * value confirmed against this institution's actual policy): on_duty is
 * EXCLUDED from both numerator and denominator — it neither helps nor
 * hurts the percentage, matching how an approved on-duty day is normally
 * treated as "doesn't count against you" rather than "counts as present"
 * (which would let a heavily-on-duty student appear to have near-perfect
 * attendance) or "counts as absent" (which unfairly penalizes an approved
 * absence). If this institution's real policy differs, change
 * ATTENDANCE_COUNTS here — every caller already goes through this one
 * function.
 */
import { round2 } from '../utils/response';

export interface AttendanceRecord {
  status: string;
}

export interface AttendanceStats {
  present: number;
  /** present + absent only — on_duty excluded, see file-level comment. */
  total: number;
  percentage: number;
}

export function computeAttendanceStats(records: AttendanceRecord[]): AttendanceStats {
  const counted = records.filter((r) => r.status === 'present' || r.status === 'absent');
  const present = counted.filter((r) => r.status === 'present').length;
  const total = counted.length;
  const percentage = total > 0 ? round2((present / total) * 100) : 0;
  return { present, total, percentage };
}
