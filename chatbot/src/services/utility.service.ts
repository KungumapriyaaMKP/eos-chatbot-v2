import { getAllIntents } from '../intent/intent.classifier';
import { WIRED_INTENT_LABELS } from '../intent/wired-intents';
import { logger } from '../utils/logger';
import { joinNaturally, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const BOT_NAME = 'EOS Assistant';

/**
 * The human-readable labels for every intent actually wired up
 * (INTENT_HANDLERS has a real handler, per wired-intents.ts) that a given
 * role is allowed to use — the same "what can THIS caller actually ask
 * about" lookup that help() and notWiredUp() below both need, now also
 * used by chat.controller.ts's low-confidence fallback (see
 * pickLowConfidenceMessage) so a failed classification can suggest real
 * topics instead of just admitting confusion.
 */
export function suggestedTopicsFor(role: string): string[] {
  const labels = getAllIntents()
    .filter((i) => i.roles.includes(role) && WIRED_INTENT_LABELS[i.name])
    .map((i) => WIRED_INTENT_LABELS[i.name]);
  return [...new Set(labels)];
}

export async function greeting({ user, match }: HandlerContext): Promise<ChatReply> {
  const firstName = user.name.split(' ')[0];
  return {
    reply: `Hi ${firstName}! I'm ${BOT_NAME}. Ask me about your attendance, marks, timetable, fees, and more.`,
    intent: match.intent,
    confidence: match.confidence,
  };
}

/** "reply is built from the role's allowed intents" — per the dataset's own description. */
export async function help({ user, match }: HandlerContext): Promise<ChatReply> {
  const unique = suggestedTopicsFor(user.role);

  const reply =
    unique.length > 0
      ? `I can help you with ${joinNaturally(unique)}. Just ask in plain English.`
      : "I'm still being set up for your role, so please check back soon.";

  return { reply, intent: match.intent, confidence: match.confidence };
}

export async function thanks({ match }: HandlerContext): Promise<ChatReply> {
  return { reply: "You're welcome! Let me know if there's anything else.", intent: match.intent, confidence: match.confidence };
}

export async function goodbye({ user, match }: HandlerContext): Promise<ChatReply> {
  return { reply: `Goodbye, ${user.name.split(' ')[0]}! Have a great day.`, intent: match.intent, confidence: match.confidence };
}

export async function botIdentity({ match }: HandlerContext): Promise<ChatReply> {
  return {
    reply: `I'm ${BOT_NAME}, the EOS ERP chatbot. I answer questions using the college's own records, not general knowledge.`,
    intent: match.intent,
    confidence: match.confidence,
  };
}

export async function wrongAnswer({ match }: HandlerContext): Promise<ChatReply> {
  return {
    reply: "Sorry about that. Could you rephrase your question? I've flagged this for review.",
    intent: match.intent,
    confidence: match.confidence,
  };
}

export async function humanHandoff({ match }: HandlerContext): Promise<ChatReply> {
  return {
    reply: 'For this, please reach out to your college office or admin desk directly. I can only answer using the ERP records.',
    intent: match.intent,
    confidence: match.confidence,
  };
}

export async function feedbackPositive({ match }: HandlerContext): Promise<ChatReply> {
  return { reply: 'Thank you, glad it helped! 😊', intent: match.intent, confidence: match.confidence };
}

/** "one calm line, no engagement" — per the dataset's own description. */
export async function abuse({ user, match }: HandlerContext): Promise<ChatReply> {
  logger.warn('utility', `Abusive message from user ${user.sub}`);
  return { reply: "Let's keep things respectful, and I'll be glad to help.", intent: match.intent, confidence: match.confidence };
}

/** "firm refusal, log it" — per the dataset's own description. */
export async function injectionAttempt({ user, match }: HandlerContext): Promise<ChatReply> {
  logger.warn('utility', `Possible prompt-injection attempt from user ${user.sub}`, { role: user.role });
  return {
    reply: "I can't do that. I only answer questions about your own ERP records, using the rules already set for your role.",
    intent: match.intent,
    confidence: match.confidence,
  };
}

/** "reply with helplines, never the generic fallback" — per the dataset's own description. */
export async function emergencyOrDistress({ user, match }: HandlerContext): Promise<ChatReply> {
  logger.warn('utility', `Emergency/distress message flagged from user ${user.sub}`);
  return {
    reply:
      'If you or someone else is in danger right now, please contact campus security or the emergency helpline immediately, ' +
      "or reach your class mentor or HOD directly. This chatbot can't handle emergencies, so please reach a person right away.",
    intent: match.intent,
    confidence: match.confidence,
  };
}

const OOS_REPLIES: Record<string, string> = {
  // Real gap found live: this used to end with "Want me to?" -- a
  // rhetorical yes/no question with no actual mechanism behind it (the
  // session's pendingIntent follow-up only fires when the NEXT message
  // fails classification outright, not when a plain "yes" successfully
  // classifies as something else, which it usually does). A student who
  // replied "yes" got the generic greeting instead, a dead-end loop.
  // Rephrased as a direct, immediately-actionable suggestion instead of a
  // question the bot can't actually follow up on.
  oos_cgpa: "I can't compute CGPA from these records yet. Try asking for your marks by subject or by semester instead.",
  oos_mess_menu: "I don't have the mess or canteen menu. Please check with the hostel or mess office.",
  oos_wifi: 'For WiFi or network issues, please contact IT support.',
  oos_syllabus: "I don't have syllabus documents, but I can show your lesson plans' subjects if that helps.",
  oos_faculty_contact: "I can't share personal staff contact numbers. Please use the official department contact channels.",
  oos_payment_action: "I can't process payments. I can only show your fee status, so please use the official payment portal to pay.",
  out_of_scope: "That's outside what I can help with. I can answer questions about your own ERP records, like attendance, marks, timetable, and fees.",
};

export async function outOfScope({ match }: HandlerContext): Promise<ChatReply> {
  const reply = (match.intent && OOS_REPLIES[match.intent]) || OOS_REPLIES.out_of_scope;
  return { reply, intent: match.intent, confidence: match.confidence };
}

/**
 * Real, legitimate requests that are NOT "out of scope" the way weather or
 * homework is — they're genuine ERP-adjacent needs — but nothing in the
 * shared database backs them (no self-service password reset, no facility
 * location table, no admissions-FAQ content store). Each gets an honest,
 * specific redirect instead of either fabricating an answer or the generic
 * "not connected yet" message.
 */
const REDIRECT_REPLIES: Record<string, string> = {
  password_reset: "I can't reset passwords myself, for security reasons. Please contact IT support or your administrator to reset it.",
  general_facilities: "I don't have campus facility locations in these records. Please check the campus signage, website, or ask at the admin office.",
  admissions_info: 'For admissions procedures, required documents, and deadlines, please check the official admissions page or contact the admissions office. I can only answer questions about your own enrolled records.',
  wallet_recharge: "I can't process a wallet recharge myself — that's a real payment, not something I can query. Please use the campus payment portal to recharge your wallet.",
  submit_feedback_form: "I can't submit a feedback form on your behalf — please use the feedback/survey portal directly. I can tell you which surveys are still awaiting your response, though.",
};

export async function redirectRequest({ match }: HandlerContext): Promise<ChatReply> {
  const reply = (match.intent && REDIRECT_REPLIES[match.intent]) || REDIRECT_REPLIES.password_reset;
  return { reply, intent: match.intent, confidence: match.confidence };
}

/**
 * Any intent the classifier recognises correctly but that has no wired
 * handler yet — see README "Intent coverage". The suggestion list is built
 * from WIRED_INTENT_LABELS the same way help() above does, rather than a
 * hardcoded string — that string went stale more than once as real
 * handlers got added (bus/route, leave status, faculty classes, ...) and
 * kept telling people to ask about a fixed, shrinking list of topics that
 * no longer matched what was actually wired up.
 */
export async function notWiredUp({ user, match }: HandlerContext): Promise<ChatReply> {
  const unique = suggestedTopicsFor(user.role);

  const suggestion =
    unique.length > 0 ? `Please try asking about ${joinNaturally(unique)}.` : "I'm still being set up for your role, so please check back soon.";

  return {
    reply: `I understood that as "${match.intent}", but I'm not connected to that part of the system yet. ${suggestion}`,
    intent: match.intent,
    confidence: match.confidence,
  };
}
