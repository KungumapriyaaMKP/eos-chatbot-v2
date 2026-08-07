import crypto from 'node:crypto';
import { prisma } from '../src/utils/prisma';

const TEST_PASSWORD = 'EOS@test123';
const TEST_HASH = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');

async function main() {
  const [facultyMatch, studentMatch, adminMatch, totalFacultyUsers, anyMatchCount] = await Promise.all([
    prisma.users.findFirst({
      where: { roles: { name: 'faculty' }, password_hash: TEST_HASH },
      select: { email: true, faculty: { select: { first_name: true, last_name: true } } },
    }),
    prisma.users.findFirst({
      where: { roles: { name: 'student' }, password_hash: TEST_HASH },
      select: { email: true },
    }),
    prisma.users.findFirst({
      where: { roles: { name: 'admin' }, password_hash: TEST_HASH },
      select: { email: true },
    }),
    prisma.users.count({ where: { roles: { name: 'faculty' } } }),
    prisma.users.count({ where: { password_hash: TEST_HASH } }),
  ]);

  console.log('total faculty users:', totalFacultyUsers);
  console.log('users anywhere matching seed password EOS@test123:', anyMatchCount);
  console.log('faculty match:', facultyMatch);
  console.log('student match:', studentMatch);
  console.log('admin match:', adminMatch);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
