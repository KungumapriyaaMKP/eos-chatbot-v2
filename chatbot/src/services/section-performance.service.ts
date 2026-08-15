import { prisma } from '../utils/prisma';
import { resolveTargetClass } from './class-match.util';
import { matchSubjectInMessage, matchExamTypeInMessage } from './subject-match.util';
import { round2, joinNaturally, markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * The "how many failed" branch below uses 40% of max_marks as the passing
 * line — like the 75% attendance figure elsewhere, this is the common
 * Indian-university convention, NOT a value stored anywhere in this schema
 * (no passing_marks field on subjects/exam_types/exam_subject_mapping).
 * Only used when explicitly asked "how many failed", and always labeled.
 */
const ASSUMED_PASS_PERCENT = 40;

const ATTENDANCE_PATTERN = /\battend/i;
const FAILED_PATTERN = /\bfail(ed|ure)?\b/i;

/**
 * section_performance — faculty (own assigned/mentored classes) / admin
 * (any class): aggregate marks or attendance performance for a whole
 * section, optionally scoped to one subject and/or exam. Reuses the same
 * class/subject resolution every other faculty-facing handler uses
 * (class-match.util.ts, subject-match.util.ts) — an hod's authority here
 * is department-wide via resolveTargetClass exactly like elsewhere.
 */
export async function getSectionPerformance({ user, message }: HandlerContext): Promise<ChatReply> {
  const { match, candidates } = await resolveTargetClass(user, message);

  if (!match) {
    if (candidates.length === 0) {
      return { reply: "You're not assigned to any classes yet.", intent: 'section_performance', confidence: 1 };
    }
    const options = joinNaturally(candidates.map((c) => c.label));
    return {
      reply: `Which class did you mean? You're linked to ${options}. Please include the class name in your question.`,
      intent: 'section_performance',
      confidence: 1,
    };
  }

  return ATTENDANCE_PATTERN.test(message) ? attendancePerformance(match) : marksPerformance(message, match);
}

async function attendancePerformance(match: { id: number; label: string }): Promise<ChatReply> {
  const records = await prisma.attendance_records.findMany({ where: { class_id: match.id }, select: { status: true } });

  if (records.length === 0) {
    return { reply: `No attendance has been recorded yet for ${match.label}.`, intent: 'section_performance', confidence: 1 };
  }

  const present = records.filter((r) => r.status === 'present').length;
  const percentage = round2((present / records.length) * 100);

  return {
    reply: `${match.label} average attendance: ${percentage}% (${present} present out of ${records.length} records).`,
    intent: 'section_performance',
    confidence: 1,
    data: { class: match.label, total: records.length, present, percentage },
  };
}

async function marksPerformance(message: string, match: { id: number; label: string }): Promise<ChatReply> {
  const [subject, examType] = await Promise.all([matchSubjectInMessage(message, match.id), matchExamTypeInMessage(message)]);

  const rows = await prisma.exam_marks.findMany({
    where: {
      exam_subject_mapping: {
        class_id: match.id,
        ...(subject && { subject_id: subject.id }),
        ...(examType && { exams: { exam_type_id: examType.id } }),
      },
    },
    select: { marks_obtained: true, max_marks: true },
  });

  const scope = [subject?.name, examType?.name].filter(Boolean).join(', ');
  const scopeLabel = scope ? ` (${scope})` : '';

  const scored = rows.filter(
    (r): r is typeof r & { marks_obtained: NonNullable<(typeof r)['marks_obtained']> } => r.marks_obtained !== null,
  );

  if (scored.length === 0) {
    return { reply: `No marks recorded yet for ${match.label}${scopeLabel}.`, intent: 'section_performance', confidence: 1 };
  }

  const percentages = scored.map((r) => (Number(r.marks_obtained) / Number(r.max_marks)) * 100);
  const average = round2(percentages.reduce((a, b) => a + b, 0) / percentages.length);
  const highest = round2(Math.max(...percentages));
  const lowest = round2(Math.min(...percentages));

  const table = markdownTable(
    ['Metric', 'Value'],
    [
      ['Students with marks entered', scored.length],
      ['Average', `${average}%`],
      ['Highest', `${highest}%`],
      ['Lowest', `${lowest}%`],
    ],
  );

  const heading = `${match.label} performance${scopeLabel}:`;
  const failedNote = FAILED_PATTERN.test(message)
    ? `\n\nBelow ${ASSUMED_PASS_PERCENT}%: ${percentages.filter((p) => p < ASSUMED_PASS_PERCENT).length} (using the standard ${ASSUMED_PASS_PERCENT}% pass convention — confirm your college's actual passing criteria, since it isn't recorded in this system).`
    : '';

  return {
    reply: `${heading}\n\n${table}${failedNote}`,
    intent: 'section_performance',
    confidence: 1,
    data: { class: match.label, subject: subject?.name ?? null, examType: examType?.name ?? null, average, highest, lowest, count: scored.length },
  };
}
