import crypto from 'node:crypto';
import { prisma } from '../src/utils/prisma';

const TEST_HASH = crypto.createHash('sha256').update('EOS@test123').digest('hex');

async function main() {
  // A parent with a real linked child, using the shared seed password.
  const parentMapping = await prisma.parent_student_mapping.findFirst({
    where: { users: { password_hash: TEST_HASH } },
    select: {
      users: { select: { email: true } },
      students: { select: { student_id_no: true } },
    },
  });

  // An hod with a real faculty profile + department.
  const hod = await prisma.users.findFirst({
    where: { roles: { name: 'hod' }, password_hash: TEST_HASH, faculty: { isNot: null } },
    select: { email: true, faculty: { select: { departments: { select: { name: true, code: true } } } } },
  });

  // Faculty with real assigned classes.
  const facultyWithClasses = await prisma.faculty_subject_class_mapping.findFirst({
    select: {
      faculty: { select: { users: { select: { email: true, password_hash: true } }, first_name: true, last_name: true } },
      classes: { select: { section: true, departments: { select: { code: true } } } },
    },
  });

  // A coe account.
  const coe = await prisma.users.findFirst({ where: { roles: { name: 'coe' }, password_hash: TEST_HASH }, select: { email: true } });

  console.log(
    JSON.stringify(
      {
        parent: parentMapping ? { email: parentMapping.users.email, childId: parentMapping.students.student_id_no } : null,
        hod: hod ? { email: hod.email, dept: hod.faculty?.departments } : null,
        facultyWithClasses: facultyWithClasses
          ? {
              email: facultyWithClasses.faculty.users?.email,
              matchesSeedPassword: facultyWithClasses.faculty.users?.password_hash === TEST_HASH,
              name: `${facultyWithClasses.faculty.first_name} ${facultyWithClasses.faculty.last_name}`,
              class: `${facultyWithClasses.classes.departments.code}-${facultyWithClasses.classes.section}`,
            }
          : null,
        coe,
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
