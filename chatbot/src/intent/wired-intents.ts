/**
 * Human-readable labels for every intent that has a real handler wired up
 * in src/intent/intent.registry.ts. Kept separate from the registry itself
 * (rather than inline) so src/services/utility.service.ts can build a
 * role-aware "help" reply without importing the registry — the registry
 * imports the services, so the services importing it back would be circular.
 *
 * Deliberately EXCLUDES two categories, even though both have real wired
 * handlers: (1) pure conversational/safety intents (greeting, thanks,
 * abuse, emergency_or_distress, ...) — not "a topic you can ask about" in
 * any useful sense; (2) the oos_ and other redirect-only intents (oos_cgpa,
 * password_reset, wallet_recharge, ...) — these exist specifically because
 * the bot CAN'T fully do the thing asked, just redirects somewhere real;
 * listing them as a suggested "topic" would imply a capability that isn't
 * actually there.
 *
 * CONFIRMED via a real audit (grep INTENT_HANDLERS keys vs. this map) that
 * this had drifted to only 25 of 97 wired handlers — 72 real, working
 * intents (wallet balance, hostel room, every admin analytics intent, most
 * of faculty-extended, ...) were invisible to help()/notWiredUp()/the
 * low-confidence fallback suggestion, silently, for however many sessions
 * of new handlers landed without a matching label. If you wire up a new
 * intent, add its label here in the SAME commit — this list has no
 * automated check against drifting again.
 */
export const WIRED_INTENT_LABELS: Record<string, string> = {
  get_profile: 'your profile',
  get_attendance: 'your attendance',
  get_timetable: "today's timetable",
  get_marks: 'your exam marks',
  get_fees: 'your fee status',
  get_exam_schedule: 'your exam schedule',
  get_exam_eligibility: 'your exam eligibility',
  get_semester_dates: 'your semester dates',
  get_announcements: 'announcements',
  get_my_subjects: 'your subjects',
  get_mentor: 'your class mentor',
  get_holidays: 'upcoming holidays',
  library_hours: 'library hours',
  get_my_bus: 'your bus and route details',
  get_bus_location: "your bus's live location",
  get_route_stops: 'your route stops',
  get_leave_status: 'your leave applications',
  faculty_my_classes: 'the classes you teach',
  faculty_leave_status: 'your leave applications',
  section_performance: "your section's performance",
  faculty_class_attendance: "a class's attendance",
  section_students: 'a class roster',
  admin_list_students: 'the student directory',
  admin_list_faculty: 'the faculty directory',
  admin_vendor_quotes: 'vendor quotations',

  // --- student/parent-facing, previously missing ---
  get_exam_seat: 'your exam seating arrangement',
  get_hall_ticket: 'your exam hall ticket',
  get_marksheet: 'your consolidated marksheet',
  get_revaluation_status: 'your revaluation request status',
  get_assignments: 'your assignments',
  get_borrowed_books: 'your borrowed library books',
  search_books: 'searching the library catalog',
  get_od_status: 'your on-duty request status',
  get_outing_status: 'your hostel outing status',
  get_notifications: 'your notifications',
  get_subject_notes: 'notes for your subjects',
  get_bonafide_status: 'your bonafide certificate status',
  get_hostel_room: 'your hostel room allocation',
  get_hostel_ledger: 'your hostel fee ledger',
  get_fee_breakup: 'your itemized fee breakup',
  get_dd_status: 'your demand draft payment status',
  get_upcoming_drives: 'upcoming placement drives',
  get_drive_applications: 'your placement drive applications',
  get_my_projects: 'your student projects',
  project_join_requests_status: 'your project join request status',
  get_student_certificates: 'your certificate requests',
  get_wallet_balance: 'your campus wallet balance',
  get_active_surveys: 'surveys awaiting your response',
  get_e_resources: 'e-resources for your subjects',
  get_profile_links: 'your resume/LinkedIn/coding profile links',
  alumni_network_search: 'searching the alumni network',
  get_result_publication_status: 'exam result publication status',
  view_department_achievements: "your department's achievements",
  get_company_info: 'details about a recruiting company',

  // --- faculty-facing, previously missing ---
  get_faculty_by_subject: 'which faculty teach a subject',
  faculty_mentees: 'the students you mentor',
  faculty_payslip: 'your payslip',
  faculty_invigilation: 'your invigilation duty',
  faculty_appraisal: 'your performance appraisal status',
  faculty_low_attendance: 'attendance-shortage students in your classes',
  faculty_media_request: 'your equipment/AV request status',

  // --- admin-facing, previously missing ---
  admin_fee_collection: 'fee collection totals',
  admin_overdue_books: 'overdue library books institution-wide',
  admin_pending_approvals: 'approvals pending your sign-off',
  admin_students_out_now: 'students currently out on pass',
  admin_hostel_occupancy: 'hostel occupancy',
  admin_marks_entry_status: 'marks-entry completion status',
  admin_admission_status: "an applicant's admission status",
  admin_dd_lookup: 'looking up a demand draft',
  admin_drive_pipeline: 'the recruitment pipeline for a drive',
  admin_gate_log: 'the campus gate entry/exit log',
  admin_po_status: 'a purchase order status',
  admin_venue_availability: 'venue/auditorium availability',
  admin_visitor_log: "today's visitor log",
};
