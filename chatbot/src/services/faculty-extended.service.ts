import { resolveOwnFaculty } from './faculty-lookup.util';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getFacultyMentees({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const faculty = await resolveOwnFaculty(user.sub);
    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_mentees', confidence: 1 };
    }

    return {
      reply: '**Your Mentee Classes**\n\nYou can view your mentee students on the faculty portal.',
      intent: 'faculty_mentees',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch mentee information.', intent: 'faculty_mentees', confidence: 1 };
  }
}

export async function getFacultyPayslip({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const faculty = await resolveOwnFaculty(user.sub);
    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_payslip', confidence: 1 };
    }

    return {
      reply: `**Your Payslips**\n\nYou can download your payslips and view salary details on the faculty/HR portal.`,
      intent: 'faculty_payslip',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch payslips.', intent: 'faculty_payslip', confidence: 1 };
  }
}

export async function getFacultyInvigilation({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const faculty = await resolveOwnFaculty(user.sub);
    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_invigilation', confidence: 1 };
    }

    return {
      reply: `**Your Invigilation Duties**\n\nCheck the examination portal for your assigned invigilation duties and hall assignments.`,
      intent: 'faculty_invigilation',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch invigilation duties.', intent: 'faculty_invigilation', confidence: 1 };
  }
}

export async function getFacultyAppraisal({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const faculty = await resolveOwnFaculty(user.sub);
    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_appraisal', confidence: 1 };
    }

    return {
      reply: `**Your Appraisal Scores**\n\nYou can view your detailed appraisal records and performance reviews on the faculty portal.`,
      intent: 'faculty_appraisal',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch appraisal details.', intent: 'faculty_appraisal', confidence: 1 };
  }
}

export async function getFacultyLowAttendance({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const faculty = await resolveOwnFaculty(user.sub);
    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_low_attendance', confidence: 1 };
    }

    return {
      reply: '**Low Attendance Report**\n\nYou can view students with low attendance in your classes on the faculty portal.',
      intent: 'faculty_low_attendance',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch low attendance data.', intent: 'faculty_low_attendance', confidence: 1 };
  }
}
