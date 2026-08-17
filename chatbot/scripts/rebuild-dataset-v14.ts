/**
 * Fourteenth dataset pass -- final pre-launch stress-test batch (30 varied
 * timetable/exam/fee/faculty/subject/leave/notice phrasings run directly
 * through classifyIntent()). Fixes the real, reproducible misses found:
 *
 *  1. "faculty for operating systems" -> admin_list_faculty (0.697), which
 *     ignores the subject entirely and dumps the WHOLE faculty roster.
 *     Root cause: get_faculty_by_subject already has a fully-built,
 *     registered handler (queries timetable_slots by subject, scoped
 *     correctly) but ZERO training examples in the dataset -- meaning it
 *     was 100% unreachable, dead code, since SBERT has nothing to match
 *     against and isRoleAllowedForIntent fails closed with an empty roles
 *     list. This activates it for real (admin/hod/faculty/coe -- the
 *     institution-wide "who teaches X" lookup; students/parents keep using
 *     get_mentor's own subject-teacher branch, which is already correctly
 *     scoped to their own class).
 *
 *  2. "do i have class tomorrow" -> get_holidays (0.910), because
 *     get_holidays' own examples include the near-identical "Do we have
 *     classes tomorrow?" -- but get_timetable is the more useful, fully
 *     built handler for this question (shows the actual periods; an empty
 *     table already reads as "no classes"). Removes the ambiguous overlap
 *     from get_holidays and reinforces get_timetable with clearer
 *     "class(es) tomorrow" phrasings.
 *
 *  3. "who is teaching cse this year" -> section_students (reranked away
 *     from a defensible admin_list_faculty 0.659 pick -- WRONG entity type,
 *     since the question is about teaching STAFF not students). Anchors
 *     "who teaches/is teaching <department>" phrasing directly onto
 *     admin_list_faculty so SBERT's own confidence clears the 0.72 rerank
 *     ceiling and the reranker never gets a say.
 *
 *  4. "open elective list" -> null (0.542, below the 0.55 threshold) -- a
 *     real unrecognized gap on get_my_subjects, which had zero
 *     elective-specific phrasing.
 *
 *  5. "college wide notice" -> get_dd_status (0.604) as SBERT's OWN pick,
 *     only saved by the reranker overriding to the correct get_announcements
 *     -- anchoring a direct example so this doesn't depend on reranker luck.
 *
 *  6. "is my mentor on leave" -> get_leave_status (0.836) -- wrong person
 *     entirely (shows the STUDENT's own leave applications in answer to a
 *     question about the MENTOR). Anchors mentor-availability phrasing onto
 *     get_mentor; the handler itself (mentor.service.ts) was separately
 *     updated to answer this framing honestly instead of just printing the
 *     identity card.
 *
 * Usage: npx tsx scripts/rebuild-dataset-v14.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type { IntentDataset, IntentDefinition } from '../src/intent/intent.types';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const CURRENT_JSON_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'intents.json');

const NEW_INTENT: IntentDefinition = {
  name: 'get_faculty_by_subject',
  module: 'Admin',
  roles: ['admin', 'hod', 'faculty', 'coe'],
  description:
    'Institution-wide "which faculty member(s) teach subject X" lookup -- reads timetable_slots directly, not scoped to any one class. Distinct from get_mentor, which answers the same underlying question but PERSONALIZED to the asking student/parent\'s own class (and is the correct route for students/parents instead of this one).',
  examples: [
    'who teaches operating systems',
    'faculty for operating systems',
    'who teaches dbms in the department',
    'which faculty member teaches data structures',
    'who is the faculty for computer networks',
    'faculty teaching software engineering',
    'who handles the machine learning course',
    'which professor teaches compiler design',
    'who is assigned to teach dbms',
    'faculty list for a subject',
    'who teaches this subject across all classes',
    'which staff member teaches operating systems',
    'who is the subject teacher for daa',
    'faculty in charge of the ai course',
    'who conducts the software engineering classes',
  ],
};

const NEW_EXAMPLES: Record<string, string[]> = {
  get_timetable: [
    'do i have class tomorrow',
    'do i have classes tomorrow',
    'is there class tomorrow',
    'are there classes tomorrow',
    'will i have classes tomorrow',
  ],
  admin_list_faculty: [
    'who teaches cse this year',
    'who is teaching cse this year',
    'who teaches in the aids department',
    'which faculty are teaching this department this year',
    'who is teaching in cse department',
  ],
  get_my_subjects: [
    'open elective list',
    'list of open electives',
    'what open electives are available',
    'my elective list',
    'which electives can i choose',
  ],
  get_announcements: [
    'college wide notice',
    'institution wide notice',
    'any notice for the whole college',
    'campus wide announcement',
  ],
  get_mentor: [
    'is my mentor on leave',
    'is my mentor on leave today',
    'is my class mentor available today',
    'is my mentor available',
    'is my subject teacher on leave',
    'will my mentor be in college today',
  ],
};

/** Examples to DROP from an existing intent -- genuinely ambiguous overlaps found live, not just additions. */
const REMOVE_EXAMPLES: Record<string, string[]> = {
  get_holidays: ['Do we have classes tomorrow?'],
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

  if (current.intents.some((i) => i.name === NEW_INTENT.name)) {
    console.error(`Intent "${NEW_INTENT.name}" already exists -- aborting.`);
    process.exit(1);
  }
  NEW_INTENT.examples = NEW_INTENT.examples.map(normalize);

  const byName = new Map(current.intents.map((i) => [i.name, i]));

  let removed = 0;
  for (const [intentName, toRemove] of Object.entries(REMOVE_EXAMPLES)) {
    const intent = byName.get(intentName);
    if (!intent) { console.warn(`Intent "${intentName}" not found -- skipping removal.`); continue; }
    const removeKeys = new Set(toRemove.map((e) => e.toLowerCase()));
    const before = intent.examples.length;
    intent.examples = intent.examples.filter((e) => !removeKeys.has(e.toLowerCase()));
    const diff = before - intent.examples.length;
    if (diff !== toRemove.length) {
      console.warn(`  Expected to remove ${toRemove.length} from "${intentName}", actually removed ${diff}.`);
    }
    removed += diff;
  }
  console.log(`Removed ${removed} ambiguous examples.`);

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
  console.log(`Added ${added} genuinely new examples to existing intents (${skippedDupes} unexpected duplicates skipped).`);

  // Insert the new intent right after admin_list_faculty so it stays
  // grouped with the other admin directory/faculty intents.
  const insertAfter = current.intents.findIndex((i) => i.name === 'admin_list_faculty');
  const intents = [...current.intents];
  intents.splice((insertAfter === -1 ? current.intents.length - 1 : insertAfter) + 1, 0, NEW_INTENT);

  const totalExamples = intents.reduce((sum, i) => sum + i.examples.length, 0);
  const finalDataset: IntentDataset = {
    generatedAt: new Date().toISOString(),
    sourceFile: current.sourceFile,
    totalIntents: intents.length,
    totalExamples,
    intents,
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
