import { prisma } from '../src/utils/prisma';

async function main() {
  const student = await prisma.students.findFirst({
    where: { status: 'active', users: { email: { not: { equals: 'student@eos.test' } } } },
    select: {
      student_id_no: true,
      roll_no: true,
      register_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      classes: { select: { section: true } },
    },
  });
  console.log(student);
  await prisma.$disconnect();
}

main();
