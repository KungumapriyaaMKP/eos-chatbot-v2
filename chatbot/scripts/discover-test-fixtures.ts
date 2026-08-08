/**
 * One-off discovery script (not part of the app) — gathers real, live data
 * IDs to drive scripts/e2e-role-rbac-test.ts against: a student with actual
 * attendance/marks rows, the parent test account's linked children, the hod
 * test account's department, a faculty member with classes, etc. Prints
 * plain JSON so the e2e script (or a human) can read it directly.
 */
import { prisma } from '../src/utils/prisma';

async function main() {
  const [attRow, marksRow, feeRow] = await Promise.all([
    prisma.attendance_records.findFirst({ select: { student_id: true } }),
    prisma.exam_marks.findFirst({ select: { student_id: true } }),
    prisma.student_fee_demand_mapping.findFirst({ select: { student_id: true } }).catch(() => null),
  ]);

  const richStudentId = marksRow?.student_id ?? attRow?.student_id;
  const richStudent = richStudentId
    ? await prisma.students.findUnique({
        where: { id: richStudentId },
        select: {
          id: true,
          student_id_no: true,
          roll_no: true,
          register_no: true,
          class_id: true,
          soa_applications: { select: { first_name: true, last_name: true } },
        },
      })
    : null;

  const parentUser = await prisma.users.findFirst({ where: { email: 'parent@eos.test' } });
  const parentChildren = parentUser
    ? await prisma.parent_student_mapping.findMany({
        where: { parent_user_id: parentUser.id },
        select: {
          students: {
            select: { id: true, student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } },
          },
        },
      })
    : [];

  const hodUser = await prisma.users.findFirst({
    where: { email: 'hod@eos.test' },
    select: { faculty: { select: { department_id: true, departments: { select: { name: true } } } } },
  });

  const facultyUser = await prisma.users.findFirst({
    where: { email: 'faculty@eos.test' },
    select: { id: true, faculty: { select: { id: true } } },
  });

  const facultyClasses = facultyUser?.faculty
    ? await prisma.faculty_subject_class_mapping
        .findMany({
          where: { faculty_id: facultyUser.faculty.id },
          select: { classes: { select: { id: true, section: true } } },
          take: 3,
        })
        .catch(() => [])
    : [];

  console.log(
    JSON.stringify(
      {
        richStudent,
        parentChildren: parentChildren.map((m) => m.students),
        hodDepartment: hodUser?.faculty?.departments?.name ?? null,
        facultyClasses: facultyClasses.map((c: any) => c.classes),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
