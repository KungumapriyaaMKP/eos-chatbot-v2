import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { formatCurrency, round2, markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** admin_fee_collection — admin: real fee_payments sum, this calendar month. */
export async function getAdminFeeCollection({ user }: HandlerContext): Promise<ChatReply> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const payments = await prisma.fee_payments.findMany({
    where: { payment_date: { gte: monthStart } },
    select: { amount_paid: true },
  });

  const total = payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
  return {
    reply: `Fee collected this month: ${formatCurrency(total)} across ${payments.length} payment(s).`,
    intent: 'admin_fee_collection',
    confidence: 1,
    data: { total, count: payments.length },
  };
}

/** admin_overdue_books — admin: real book_borrow_records not yet returned past their due date. */
export async function getAdminOverdueBooks({ user }: HandlerContext): Promise<ChatReply> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const overdue = await prisma.book_borrow_records.findMany({
    where: { returned_date: null, due_date: { lt: today } },
    select: {
      due_date: true,
      books: { select: { title: true } },
      students: { select: { student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } } },
    },
  });

  if (overdue.length === 0) {
    return { reply: 'No overdue books right now.', intent: 'admin_overdue_books', confidence: 1 };
  }

  const table = markdownTable(
    ['Book', 'Borrower', 'Due Date'],
    overdue.map((r) => [
      r.books.title,
      r.students ? [r.students.soa_applications?.first_name, r.students.soa_applications?.last_name].filter(Boolean).join(' ') || r.students.student_id_no : 'N/A',
      r.due_date.toISOString().slice(0, 10),
    ]),
  );
  return { reply: `${overdue.length} overdue book(s):\n\n${table}`, intent: 'admin_overdue_books', confidence: 1, data: overdue };
}

/** admin_pending_approvals — admin: real pending-status counts across every approval-gated workflow this codebase knows about. */
export async function getAdminPendingApprovals({ user }: HandlerContext): Promise<ChatReply> {
  const [studentLeaves, facultyLeaves, outings, odApprovals, bonafide] = await Promise.all([
    prisma.student_leaves.count({ where: { status: 'pending' } }),
    prisma.faculty_leaves.count({ where: { OR: [{ hod_approval_status: 'pending' }, { hr_approval_status: 'pending' }] } }),
    prisma.hostel_outings.count({ where: { status: 'pending' } }),
    prisma.od_request_hod_approvals.count({ where: { status: 'pending' } }),
    prisma.bonafide_requests.count({ where: { status: 'pending' } }),
  ]);

  const table = markdownTable(
    ['Category', 'Pending'],
    [
      ['Student leaves', studentLeaves],
      ['Faculty leaves', facultyLeaves],
      ['Hostel outings', outings],
      ['OD requests', odApprovals],
      ['Bonafide requests', bonafide],
    ],
  );
  return {
    reply: `Pending approvals:\n\n${table}`,
    intent: 'admin_pending_approvals',
    confidence: 1,
    data: { studentLeaves, facultyLeaves, outings, odApprovals, bonafide },
  };
}

/** admin_students_out_now — admin: each student's MOST RECENT hostel_in_out_ledger entry, filtered to 'out'. */
export async function getAdminStudentsOutNow({ user }: HandlerContext): Promise<ChatReply> {
  const entries = await prisma.hostel_in_out_ledger.findMany({
    orderBy: { recorded_at: 'desc' },
    select: {
      student_id: true,
      entry_type: true,
      recorded_at: true,
      students: { select: { student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } } },
    },
  });

  const latestByStudent = new Map<number, (typeof entries)[number]>();
  for (const e of entries) {
    if (!latestByStudent.has(e.student_id)) latestByStudent.set(e.student_id, e);
  }
  const outNow = [...latestByStudent.values()].filter((e) => e.entry_type === 'out');

  if (outNow.length === 0) {
    return { reply: 'No students are currently marked as out.', intent: 'admin_students_out_now', confidence: 1 };
  }

  const table = markdownTable(
    ['Student', 'Since'],
    outNow.map((e) => [[e.students.soa_applications?.first_name, e.students.soa_applications?.last_name].filter(Boolean).join(' ') || e.students.student_id_no, e.recorded_at.toISOString()]),
  );
  return { reply: `${outNow.length} student(s) currently out:\n\n${table}`, intent: 'admin_students_out_now', confidence: 1, data: outNow };
}

/** admin_hostel_occupancy — admin: real hostel_rooms capacity vs student_hostel_mapping allocation count. */
export async function getAdminHostelOccupancy({ user }: HandlerContext): Promise<ChatReply> {
  const [rooms, allocated] = await Promise.all([
    prisma.hostel_rooms.findMany({ select: { capacity: true } }),
    prisma.student_hostel_mapping.count(),
  ]);

  const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
  const percentage = totalCapacity > 0 ? round2((allocated / totalCapacity) * 100) : 0;

  return {
    reply: `Hostel occupancy: ${allocated} of ${totalCapacity} beds filled (${percentage}%), across ${rooms.length} room(s).`,
    intent: 'admin_hostel_occupancy',
    confidence: 1,
    data: { totalCapacity, allocated, percentage },
  };
}

/** admin_marks_entry_status — admin: exam_subject_mapping rows with zero exam_marks entered, per exam. */
export async function getAdminMarksEntryStatus({ user }: HandlerContext): Promise<ChatReply> {
  const mappings = await prisma.exam_subject_mapping.findMany({
    select: {
      id: true,
      subjects: { select: { name: true } },
      exams: { select: { exam_types: { select: { name: true } } } },
      _count: { select: { exam_marks: true } },
    },
  });

  const notStarted = mappings.filter((m) => m._count.exam_marks === 0);
  if (notStarted.length === 0) {
    return { reply: `Marks entry has started for every subject/exam mapping (${mappings.length} total).`, intent: 'admin_marks_entry_status', confidence: 1 };
  }

  const table = markdownTable(['Exam', 'Subject'], notStarted.slice(0, 20).map((m) => [m.exams.exam_types.name, m.subjects.name]));
  const more = notStarted.length > 20 ? `\n\n...and ${notStarted.length - 20} more.` : '';
  return {
    reply: `${notStarted.length} of ${mappings.length} subject/exam mappings have no marks entered yet:\n\n${table}${more}`,
    intent: 'admin_marks_entry_status',
    confidence: 1,
    data: { total: mappings.length, notStarted: notStarted.length },
  };
}

/**
 * admin_institution_performance — admin: institution-wide, hod:
 * department-wide cross-class aggregate. Real gap found during a
 * comprehensive audit: section_performance already covers attendance/marks
 * for ONE named class at a time, but there was no way to ask for a
 * cross-class average or a best/worst-performing section comparison.
 *
 * Attendance excludes on_duty from both numerator and denominator, same
 * convention as attendance-stats.util.ts (an approved on-duty day is an
 * excused absence, shouldn't count against a class either way here).
 */
export async function getInstitutionPerformance({ user }: HandlerContext): Promise<ChatReply> {
  let departmentFilter: { department_id?: number } = {};
  let scopeLabel = 'the institution';

  if (user.role === ROLES.HOD) {
    const faculty = await prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true, departments: { select: { name: true } } },
    });
    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'admin_institution_performance', confidence: 1 };
    }
    departmentFilter = { department_id: faculty.department_id };
    scopeLabel = faculty.departments.name;
  }

  const classes = await prisma.classes.findMany({
    where: departmentFilter,
    select: { id: true, section: true, departments: { select: { code: true } } },
  });

  if (classes.length === 0) {
    return { reply: `No classes found for ${scopeLabel}.`, intent: 'admin_institution_performance', confidence: 1 };
  }

  const classIds = classes.map((c) => c.id);
  const classLabel = new Map(classes.map((c) => [c.id, `${c.departments.code}-${c.section}`]));

  const [attendanceRecords, marksRecords, totalStudents] = await Promise.all([
    prisma.attendance_records.findMany({
      where: { class_id: { in: classIds } },
      select: { class_id: true, status: true },
    }),
    prisma.exam_marks.findMany({
      where: { exam_subject_mapping: { class_id: { in: classIds } }, marks_obtained: { not: null } },
      select: { marks_obtained: true, max_marks: true, exam_subject_mapping: { select: { class_id: true } } },
    }),
    prisma.students.count({ where: { class_id: { in: classIds } } }),
  ]);

  const attendanceByClass = new Map<number, { present: number; total: number }>();
  for (const r of attendanceRecords) {
    if (r.status !== 'present' && r.status !== 'absent') continue; // on_duty excluded, see attendance-stats.util.ts
    const entry = attendanceByClass.get(r.class_id) ?? { present: 0, total: 0 };
    entry.total += 1;
    if (r.status === 'present') entry.present += 1;
    attendanceByClass.set(r.class_id, entry);
  }
  const attendancePercentages = [...attendanceByClass.entries()]
    .filter(([, v]) => v.total > 0)
    .map(([classId, v]) => ({ classId, percentage: round2((v.present / v.total) * 100) }));

  const marksByClass = new Map<number, number[]>();
  for (const r of marksRecords) {
    const pct = (Number(r.marks_obtained) / Number(r.max_marks)) * 100;
    const arr = marksByClass.get(r.exam_subject_mapping.class_id) ?? [];
    arr.push(pct);
    marksByClass.set(r.exam_subject_mapping.class_id, arr);
  }
  const marksPercentages = [...marksByClass.entries()].map(([classId, arr]) => ({
    classId,
    percentage: round2(arr.reduce((a, b) => a + b, 0) / arr.length),
  }));

  const lines: string[] = [`Performance summary for ${scopeLabel} (${classes.length} class(es), ${totalStudents} student(s) enrolled):`];

  if (attendancePercentages.length > 0) {
    const avg = round2(attendancePercentages.reduce((s, p) => s + p.percentage, 0) / attendancePercentages.length);
    const best = attendancePercentages.reduce((a, b) => (b.percentage > a.percentage ? b : a));
    const worst = attendancePercentages.reduce((a, b) => (b.percentage < a.percentage ? b : a));
    lines.push(
      '',
      `Attendance — average ${avg}% across ${attendancePercentages.length} class(es) with recorded attendance.`,
      `Best: ${classLabel.get(best.classId)} (${best.percentage}%). Worst: ${classLabel.get(worst.classId)} (${worst.percentage}%).`,
    );
  } else {
    lines.push('', `No attendance has been recorded yet for ${scopeLabel}.`);
  }

  if (marksPercentages.length > 0) {
    const avg = round2(marksPercentages.reduce((s, p) => s + p.percentage, 0) / marksPercentages.length);
    const best = marksPercentages.reduce((a, b) => (b.percentage > a.percentage ? b : a));
    const worst = marksPercentages.reduce((a, b) => (b.percentage < a.percentage ? b : a));
    lines.push(
      '',
      `Marks — average ${avg}% across ${marksPercentages.length} class(es) with recorded marks.`,
      `Best: ${classLabel.get(best.classId)} (${best.percentage}%). Worst: ${classLabel.get(worst.classId)} (${worst.percentage}%).`,
    );
  } else {
    lines.push('', `No marks have been recorded yet for ${scopeLabel}.`);
  }

  return {
    reply: lines.join('\n'),
    intent: 'admin_institution_performance',
    confidence: 1,
    data: { classes: classes.length, totalStudents, attendancePercentages, marksPercentages },
  };
}
