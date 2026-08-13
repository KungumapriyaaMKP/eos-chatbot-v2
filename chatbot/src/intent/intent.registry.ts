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
import { getFacultyBySubject } from '../services/faculty-by-subject.service';
import { adminListStudents, adminListFaculty } from '../services/admin-directory.service';
import { getMyBus, getBusLocation, getRouteStops } from '../services/transport.service';
import { getLeaveStatus } from '../services/leave-status.service';
import { getFacultyLeaveStatus } from '../services/faculty-leave-status.service';
import { getSectionPerformance } from '../services/section-performance.service';
import { getExamEligibility } from '../services/exam-eligibility.service';
import { getSemesterDates } from '../services/semester-dates.service';
import { adminVendorQuotes } from '../services/admin-vendor.service';
import { getBonafideStatus } from '../services/bonafide.service';
import { getBorrowedBooks, searchBooks } from '../services/library-borrowed.service';
import { getHallTicket, getExamSeat, getMarksheet, getRevaluationStatus } from '../services/exam-documents.service';
import { getHostelRoom, getHostelLedger, getOutingStatus } from '../services/hostel.service';
import { getFeeBreakup, getDDStatus } from '../services/fee-details.service';
import { getUpcomingDrives, getDriveApplications } from '../services/placement.service';
import { getODStatus, getNotifications, getSubjectNotes } from '../services/student-requests.service';
import { getFacultyMentees, getFacultyPayslip, getFacultyInvigilation, getFacultyAppraisal, getFacultyLowAttendance } from '../services/faculty-extended.service';
import { getAdminFeeCollection, getAdminOverdueBooks, getAdminPendingApprovals, getAdminStudentsOutNow, getAdminHostelOccupancy, getAdminMarksEntryStatus } from '../services/admin-analytics.service';
import { getMyProjects, getProjectJoinRequests } from '../services/student-projects.service';
import { getStudentCertificates } from '../services/certificates.service';
import { getWalletBalance, rechargeWallet } from '../services/wallet.service';
import { submitFeedbackForm, getActiveSurveys } from '../services/feedback.service';
import { searchAlumniNetwork, getResultPublicationStatus, viewDepartmentAchievements } from '../services/alumni.service';
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
  get_exam_eligibility: getExamEligibility,
  get_semester_dates: getSemesterDates,
  get_exam_seat: getExamSeat,
  get_hall_ticket: getHallTicket,
  get_marksheet: getMarksheet,
  get_revaluation_status: getRevaluationStatus,
  get_announcements: getAnnouncements,
  get_my_subjects: getSubjects,
  get_mentor: getMentor,
  get_holidays: getHolidays,
  library_hours: getLibraryHours,
  get_borrowed_books: getBorrowedBooks,
  search_books: searchBooks,
  get_my_bus: getMyBus,
  get_bus_location: getBusLocation,
  get_route_stops: getRouteStops,
  get_leave_status: getLeaveStatus,
  get_od_status: getODStatus,
  get_outing_status: getOutingStatus,
  get_notifications: getNotifications,
  get_subject_notes: getSubjectNotes,
  get_bonafide_status: getBonafideStatus,
  get_hostel_room: getHostelRoom,
  get_hostel_ledger: getHostelLedger,
  get_fee_breakup: getFeeBreakup,
  get_dd_status: getDDStatus,
  get_upcoming_drives: getUpcomingDrives,
  get_drive_applications: getDriveApplications,
  get_my_projects: getMyProjects,
  project_join_requests_status: getProjectJoinRequests,
  get_student_certificates: getStudentCertificates,
  get_wallet_balance: getWalletBalance,
  wallet_recharge: rechargeWallet,
  submit_feedback_form: submitFeedbackForm,
  get_active_surveys: getActiveSurveys,
  alumni_network_search: searchAlumniNetwork,
  get_result_publication_status: getResultPublicationStatus,
  view_department_achievements: viewDepartmentAchievements,

  // Faculty
  faculty_my_classes: getFacultyClasses,
  faculty_class_attendance: getClassAttendance,
  section_students: getSectionStudents,
  faculty_leave_status: getFacultyLeaveStatus,
  section_performance: getSectionPerformance,
  get_faculty_by_subject: getFacultyBySubject,
  faculty_mentees: getFacultyMentees,
  faculty_payslip: getFacultyPayslip,
  faculty_invigilation: getFacultyInvigilation,
  faculty_appraisal: getFacultyAppraisal,
  faculty_low_attendance: getFacultyLowAttendance,

  // Admin
  admin_list_students: adminListStudents,
  admin_list_faculty: adminListFaculty,
  admin_vendor_quotes: adminVendorQuotes,
  admin_fee_collection: getAdminFeeCollection,
  admin_overdue_books: getAdminOverdueBooks,
  admin_pending_approvals: getAdminPendingApprovals,
  admin_students_out_now: getAdminStudentsOutNow,
  admin_hostel_occupancy: getAdminHostelOccupancy,
  admin_marks_entry_status: getAdminMarksEntryStatus,

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
