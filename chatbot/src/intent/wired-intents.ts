/**
 * Human-readable labels for every intent that has a real handler wired up
 * in src/intent/intent.registry.ts. Kept separate from the registry itself
 * (rather than inline) so src/services/utility.service.ts can build a
 * role-aware "help" reply without importing the registry — the registry
 * imports the services, so the services importing it back would be circular.
 *
 * This is intentionally a curated SUBSET of the 80 intents the SBERT
 * classifier recognises (see README "Intent coverage") — every other
 * recognised intent still gets a clean, honest "not wired up yet" reply
 * instead of silently doing nothing.
 */
export const WIRED_INTENT_LABELS: Record<string, string> = {
  get_profile: 'your profile',
  get_attendance: 'your attendance',
  get_timetable: "today's timetable",
  get_marks: 'your exam marks',
  get_fees: 'your fee status',
  get_exam_schedule: 'your exam schedule',
  get_announcements: 'announcements',
  get_my_subjects: 'your subjects',
  get_mentor: 'your class mentor',
  get_holidays: 'upcoming holidays',
  library_hours: 'library hours',
  faculty_my_classes: 'the classes you teach',
  faculty_class_attendance: "a class's attendance",
  section_students: 'a class roster',
  admin_list_students: 'the student directory',
  admin_list_faculty: 'the faculty directory',
};
