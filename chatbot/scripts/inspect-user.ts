import { prisma } from '../src/utils/prisma';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/inspect-user.ts <email>');
    process.exit(1);
  }
  const user = await prisma.users.findUnique({
    where: { email },
    include: {
      roles: true,
      faculty: { select: { first_name: true, last_name: true } },
      students: {
        select: {
          student_id_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
        },
      },
    },
  });
  console.log(JSON.stringify(user, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
