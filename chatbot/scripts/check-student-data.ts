import { prisma } from '../src/utils/prisma';

async function main() {
  const attendanceRow = await prisma.attendance_records.findFirst({ select: { student_id: true } });
  const marksRow = await prisma.exam_marks.findFirst({ select: { student_id: true } });

  const candidateIds = [attendanceRow?.student_id, marksRow?.student_id].filter(Boolean) as number[];

  for (const id of candidateIds) {
    const [student, attCount, marksCount] = await Promise.all([
      prisma.students.findUnique({ where: { id }, select: { student_id_no: true, roll_no: true } }),
      prisma.attendance_records.count({ where: { student_id: id } }),
      prisma.exam_marks.count({ where: { student_id: id } }),
    ]);
    console.log(id, student, 'attendance:', attCount, 'marks:', marksCount);
  }

  await prisma.$disconnect();
}

main();
