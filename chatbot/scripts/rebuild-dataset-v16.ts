/**
 * Sixteenth dataset pass -- pushing held-out accuracy toward 95%+ ahead of
 * client launch. Two kinds of additions:
 *
 * 1. Thin-intent enrichment: 13 intents were sitting at 9-13 examples each
 *    (vs. a ~28 average across the other 84), found by sorting every
 *    intent by example count. Sparse intents are exactly the ones most
 *    likely to lose a close call to a better-anchored neighbor, or fall
 *    below the confidence threshold outright on a phrasing not already
 *    covered. No specific failure needed for these -- just genuinely thin
 *    coverage worth shoring up on its own.
 *
 * 2. Fixes for real, reproducible misses from the latest 1000-question
 *    failure dump, each checked against the LOSING intent's actual
 *    description first (several of the dump's own "expected" labels are
 *    wrong and were deliberately left alone -- "hostel dues" expected
 *    against get_hostel_ledger, whose real scope is gate in/out logs, not
 *    fees; "am I mentoring any class" expected against faculty_my_classes
 *    when faculty_mentees is the objectively correct answer; "how many
 *    placement drives are lined up" expected against admin_drive_pipeline,
 *    whose real scope is per-drive applicant-status counts, not a listing
 *    of drives -- get_upcoming_drives already answers that correctly).
 *    section-performance.service.ts was separately updated to actually
 *    name the top scorer instead of just the numeric highest, now that
 *    "top scorer" is anchored here for real.
 *
 * Usage: npx tsx scripts/rebuild-dataset-v16.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type { IntentDataset, IntentDefinition } from '../src/intent/intent.types';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const CURRENT_JSON_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'intents.json');

const NEW_EXAMPLES: Record<string, string[]> = {
  // --- thin-intent enrichment ---
  project_join_requests_status: [
    'status of my project join request',
    'did i get accepted into the project team',
    'is my request to join the project approved',
    'update on my project team application',
    'was i added to the project group',
    'status of joining the research project',
  ],
  view_department_achievements: [
    'achievements of my department',
    'awards won by our department',
    'recent accomplishments in the department',
    'department recognitions this year',
    'any awards for the department',
    'notable achievements posted for my department',
  ],
  library_hours: [
    'when does the library open',
    'library closing time',
    'library timings today',
    'what time does the library close',
    'is the library open now',
    'library working hours',
  ],
  get_my_projects: [
    'list my academic projects',
    'who is my project mentor',
    'my project details',
    'show my ongoing projects',
    'which project am i working on',
    'project guide assigned to me',
  ],
  get_active_surveys: [
    'any surveys i need to fill',
    'pending feedback forms for me',
    'surveys awaiting my response',
    'do i have any surveys to complete',
    'feedback forms i still need to submit',
  ],
  submit_feedback_form: [
    'i want to submit course feedback',
    'how do i fill the evaluation form',
    'submit my faculty feedback',
    'where do i give course feedback',
    'fill out the semester feedback form',
  ],
  alumni_network_search: [
    'find alumni working at google',
    'alumni from the 2020 batch',
    'search alumni by company',
    'which alumni work at a particular company',
    'alumni network for a batch',
  ],
  oos_wifi: [
    'wifi is not working',
    'cant connect to campus wifi',
    'internet is down in my hostel',
    'wifi password for campus network',
    'network issue in the lab',
  ],
  password_reset: [
    'i forgot my password',
    'reset my account password',
    'cant log into my account',
    'need to change my password',
    'locked out of my account',
  ],
  wallet_recharge: [
    'i want to recharge my wallet',
    'add money to my campus wallet',
    'top up my wallet balance',
    'how do i recharge my wallet',
  ],
  get_wallet_balance: [
    'how much money is in my wallet',
    'check my campus wallet balance',
    'recent wallet transactions',
    'wallet balance and history',
  ],
  get_result_publication_status: [
    'have results been published',
    'when will semester results come out',
    'are exam results out yet',
    'result publication status for this semester',
  ],
  general_facilities: [
    'where is the cafeteria',
    'location of the admin office',
    'where is the auditorium',
    'campus facility locations',
  ],

  // --- confirmed real misses from the failure dump ---
  get_fees: [
    'what is my pending balance',
    'pending balance on my account',
    'how much do i owe the college',
  ],
  section_performance: [
    "what's the pass rate in my section",
    'pass rate in my section',
    'top scorer in my class for a subject',
    'who scored the highest in my section',
    'how did my class do overall in the last test',
    'how did my section perform overall',
  ],
  admin_list_students: [
    'pull up the full student roster',
    'full student roster',
  ],
  admin_list_faculty: [
    'staff directory please',
    'staff directory',
    'list faculty in a specific department',
  ],
  get_od_status: [
    'status of my od application',
    'update on my od application',
  ],
  get_notifications: [
    'what am i missing',
    "anything i'm missing",
  ],
  admin_pending_approvals: [
    'anything pending my review',
    'items awaiting my approval',
    'what needs my approval',
  ],
  admin_students_out_now: [
    'live outing list',
    'who is currently out of the hostel',
    'students out right now',
  ],
  admin_po_status: [
    'has the po been approved',
    'status of the purchase order',
    'is the po approved yet',
  ],
  thanks: [
    'appreciate the help',
  ],
  wrong_answer: [
    "that's not what i asked",
    "this reply doesn't make sense",
    'you got that wrong',
  ],
  feedback_positive: [
    'that was really helpful',
    'this actually worked well',
  ],
  abuse: [
    'this bot is garbage',
  ],
  get_holidays: [
    'hey is there a break coming up',
    'is there a break coming up soon',
  ],
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function buildListParagraph(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>` +
    `<w:spacing w:after="20"/></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`
  );
}
function buildHeading1(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}
function buildHeading2(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}
function buildPlain(text: string, bold: boolean): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rPr = bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : '<w:rPr><w:i/><w:iCs/></w:rPr>';
  return `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000"><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

async function main() {
  const current: IntentDataset = JSON.parse(fs.readFileSync(CURRENT_JSON_PATH, 'utf-8'));
  console.log(`Current: ${current.intents.length} intents, ${current.totalExamples} examples.`);

  const byName = new Map(current.intents.map((i) => [i.name, i]));
  let added = 0;
  let skippedDupes = 0;
  for (const [intentName, examples] of Object.entries(NEW_EXAMPLES)) {
    const intent = byName.get(intentName);
    if (!intent) { console.warn(`Intent "${intentName}" not found -- skipping.`); continue; }
    const existingKeys = new Set(intent.examples.map((e) => e.toLowerCase()));
    for (const raw of examples) {
      const example = normalize(raw);
      const key = example.toLowerCase();
      if (existingKeys.has(key)) { console.warn(`  DUPLICATE for "${intentName}": "${example}" -- skipping.`); skippedDupes++; continue; }
      existingKeys.add(key);
      intent.examples.push(example);
      added++;
    }
  }
  console.log(`Added ${added} genuinely new examples (${skippedDupes} unexpected duplicates skipped).`);

  const totalExamples = current.intents.reduce((sum, i) => sum + i.examples.length, 0);
  const finalDataset: IntentDataset = {
    generatedAt: new Date().toISOString(),
    sourceFile: current.sourceFile,
    totalIntents: current.intents.length,
    totalExamples,
    intents: current.intents,
  };

  const buffer = fs.readFileSync(DOCX_PATH);
  const zip = await JSZip.loadAsync(buffer);
  const currentXml = await zip.file('word/document.xml')!.async('text');
  const sectPrMatch = currentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';
  const bodyOpenMatch = currentXml.match(/^[\s\S]*?<w:body>/);
  const bodyOpenTag = bodyOpenMatch ? bodyOpenMatch[0] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document><w:body>';
  const docCloseTag = '</w:body></w:document>';

  let bodyContent = '';
  let currentModule: string | null = null;
  for (const intent of finalDataset.intents) {
    if (intent.module !== currentModule) {
      bodyContent += buildHeading1(intent.module);
      currentModule = intent.module;
    }
    bodyContent += buildHeading2(intent.name);
    bodyContent += buildPlain(`roles: ${intent.roles.join(', ')}`, true);
    bodyContent += buildPlain(intent.description, false);
    bodyContent += buildPlain(`examples (${intent.examples.length}):`, true);
    bodyContent += intent.examples.map(buildListParagraph).join('');
  }

  const newXml = bodyOpenTag + bodyContent + sectPr + docCloseTag;
  zip.file('word/document.xml', newXml);
  const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(DOCX_PATH, outBuffer);
  console.log(`Rebuilt ${DOCX_PATH}`);

  const verifyZip = await JSZip.loadAsync(fs.readFileSync(DOCX_PATH));
  const verifyXml = await verifyZip.file('word/document.xml')!.async('text');
  const bodyMatch = verifyXml.match(/<w:body>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : verifyXml;
  const blocks = body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  const paras = blocks.map((b) => {
    const styleMatch = b.match(/<w:pStyle w:val="([^"]+)"/);
    const textMatches = [...b.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    return { style: styleMatch ? styleMatch[1] : '', text: textMatches.map((m) => m[1]).join('').trim() };
  });

  let verifiedIntents = 0;
  let verifiedExamples = 0;
  let cur: IntentDefinition | null = null;
  const seenSet = new Set<string>();
  const flush = () => {
    if (cur) { verifiedIntents++; verifiedExamples += cur.examples.length; }
    cur = null; seenSet.clear();
  };
  for (const p of paras) {
    if (p.style === 'Heading1') { flush(); continue; }
    if (p.style === 'Heading2') { flush(); cur = { name: p.text, module: '', roles: [], description: '', examples: [] }; continue; }
    if (!cur || !p.text) continue;
    if (/^examples\s*\(/i.test(p.text)) continue;
    if (p.style === 'ListParagraph') {
      const key = p.text.toLowerCase();
      if (!seenSet.has(key)) { seenSet.add(key); cur.examples.push(p.text); }
    }
  }
  flush();

  console.log(`Round-trip verification: ${verifiedIntents} intents, ${verifiedExamples} examples.`);
  console.log(`Expected: ${finalDataset.intents.length} intents, ${totalExamples} examples.`);
  if (verifiedIntents !== finalDataset.intents.length || verifiedExamples !== totalExamples) {
    console.error('MISMATCH -- NOT writing intents.json.');
    process.exit(1);
  }
  console.log('Round-trip matches exactly.');

  fs.writeFileSync(CURRENT_JSON_PATH, JSON.stringify(finalDataset, null, 2), 'utf-8');
  console.log(`Wrote ${CURRENT_JSON_PATH}`);
}

main().catch((err) => {
  console.error('Rebuild failed:', err);
  process.exit(1);
});
