import type { IntentHandler } from './intent.types';
import { getProfile } from '../services/profile.service';
import { getAttendance } from '../services/attendance.service';
import { getTimetable } from '../services/timetable.service';
import { getMarks } from '../services/marks.service';
import { getFees } from '../services/fees.service';
import { getExamSchedule } from '../services/exam-schedule.service';
import { getAnnouncements } from '../services/announcements.service';
import { getSubjects } from '../services/subjects.service';
import { getMentor } from '../services/mentor.service';
import { getHolidays } from '../services/holidays.service';
import { getLibraryHours } from '../services/library.service';
import { getFacultyClasses, getClassAttendance, getSectionStudents } from '../services/faculty-classes.service';
import { adminListStudents, adminListFaculty } from '../services/admin-directory.service';
import {
  greeting,
  help,
  thanks,
  goodbye,
  botIdentity,
  wrongAnswer,
  humanHandoff,
  feedbackPositive,
  abuse,
  injectionAttempt,
  emergencyOrDistress,
  outOfScope,
  redirectRequest,
} from '../services/utility.service';

/**
 * Intent name → handler. This is the ONE place that decides what happens
 * once RBAC has already approved an intent for the caller's role
 * (src/middleware/rbac.middleware.ts runs first — see src/routes/chat.routes.ts).
 *
 * Every intent below maps 1:1 to the "Intent Mapping" examples in the brief
 * (getAttendance, getMarks, getTimetable, getProfile, getFees,
 * getExamSchedule, getAnnouncements, getSubjects), plus a faculty/admin tier
 * to prove the RBAC boundaries hold for every role, plus the utility /
 * out-of-scope intents so the bot never just goes silent, plus a handful
 * merged in from a second, user-supplied generic pattern sheet (get_mentor,
 * get_holidays, library_hours have real backend data and are wired live;
 * password_reset/general_facilities/admissions_info don't, and get an
 * honest redirect instead).
 *
 * The training dataset recognises 84 intents in total (see
 * src/embeddings/intents.json after `npm run train`) — everything NOT in
 * this map still gets classified correctly, it just falls through to
 * utility.service.notWiredUp() in src/routes/chat.routes.ts. Adding real
 * support for one of those is: write a services/*.ts handler, import it
 * here, add one line below.
 */
export const INTENT_HANDLERS: Record<string, IntentHandler> = {
  // Student self-service (also admin, via register-number lookup)
  get_profile: getProfile,
  get_attendance: getAttendance,
  get_timetable: getTimetable,
  get_marks: getMarks,
  get_fees: getFees,
  get_exam_schedule: getExamSchedule,
  get_announcements: getAnnouncements,
  get_my_subjects: getSubjects,
  get_mentor: getMentor,
  get_holidays: getHolidays,
  library_hours: getLibraryHours,

  // Faculty
  faculty_my_classes: getFacultyClasses,
  faculty_class_attendance: getClassAttendance,
  section_students: getSectionStudents,

  // Admin
  admin_list_students: adminListStudents,
  admin_list_faculty: adminListFaculty,

  // Utility (no DB access)
  greeting,
  help,
  thanks,
  goodbye,
  bot_identity: botIdentity,
  wrong_answer: wrongAnswer,
  human_handoff: humanHandoff,
  feedback_positive: feedbackPositive,
  abuse,
  injection_attempt: injectionAttempt,
  emergency_or_distress: emergencyOrDistress,

  // Out of scope
  out_of_scope: outOfScope,
  oos_cgpa: outOfScope,
  oos_mess_menu: outOfScope,
  oos_wifi: outOfScope,
  oos_syllabus: outOfScope,
  oos_faculty_contact: outOfScope,
  oos_payment_action: outOfScope,

  // Real needs, no backing data — honest redirect, not a fabricated answer
  password_reset: redirectRequest,
  general_facilities: redirectRequest,
  admissions_info: redirectRequest,
};
