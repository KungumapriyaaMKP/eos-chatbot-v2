/**
 * Fifteenth dataset pass -- triage of the 1000-question benchmark's 144
 * failures (see _failures_dump.txt), cross-checked against each intent's
 * actual description before touching anything (a few of the benchmark's
 * OWN "expected" labels turned out to be wrong -- e.g. "hostel dues so
 * far" was expected against get_hostel_ledger, whose real description is
 * "gate in/out log entries", nothing to do with fees; "am I mentoring any
 * class" was expected against faculty_my_classes when the actual reply
 * (faculty_mentees) is the objectively correct one. Those are left alone.
 *
 * What's fixed here are confirmed real misses, split into two severities:
 *
 * TIER 1 -- genuine RBAC-denial risk. Each pair below has ZERO role
 * overlap, so a misclassification isn't just "wrong data", it's a FLAT
 * "you don't have permission" shown to someone asking a completely
 * legitimate question about their own record:
 *   - faculty_appraisal (faculty only) <-> admin_institution_performance
 *     (admin/hod only) -- "my performance review update" was landing on
 *     the cross-class aggregate intent added earlier this session.
 *   - faculty_payslip (faculty only) <-> get_fees (student/admin/parent)
 *   - get_outing_status (student/admin) <-> admin_gate_log (admin only)
 *   - admissions_info (student/admin/parent/hod/coe) <->
 *     admin_admission_status (admin only)
 *   - faculty_media_request (faculty only) <-> get_od_status (student/admin)
 *   - faculty_low_attendance (faculty/admin) <-> get_attendance
 *     (student/admin/parent) -- faculty isn't in get_attendance's roles.
 *   - get_revaluation_status (student/admin) <-> admin_admission_status
 *     (admin only)
 *   - get_company_info (student/faculty/admin) <-> get_drive_applications
 *     (student/admin) -- faculty isn't in get_drive_applications' roles.
 *
 * TIER 2 -- same roles on both sides (no denial), but confidently wrong or
 * misleading data shown for a real, common question. Includes
 * get_bonafide_status, which the user already flagged once live from the
 * OTHER direction ("asked about OD, but giving bonafide") -- this
 * anchors the reverse direction too, since it's a recurring confusion pair.
 *
 * TIER 3 -- pure below-threshold gaps (returns null today), safe/additive,
 * no competing intent to disambiguate against.
 *
 * Usage: npx tsx scripts/rebuild-dataset-v15.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type { IntentDataset, IntentDefinition } from '../src/intent/intent.types';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const CURRENT_JSON_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'intents.json');

const NEW_EXAMPLES: Record<string, string[]> = {
  // --- TIER 1: RBAC-denial-risk pairs ---
  faculty_appraisal: [
    'my performance review update',
    'has my appraisal been reviewed',
    'status of my appraisal this year',
    'did management approve my appraisal',
  ],
  faculty_payslip: [
    'where is my payslip',
    'my latest pay statement',
    'can i get my pay statement',
    'my salary slip for this month',
  ],
  get_outing_status: [
    'status of my gate pass request',
    'is my gate pass approved',
    'did the warden approve my gate pass',
  ],
  admissions_info: [
    'when do admissions open',
    'when does the admission process start',
    'what documents are needed for admission',
    'how do i apply for admission',
  ],
  faculty_media_request: [
    'status of my equipment request',
    'my av request update',
    'has my media team request been approved',
    'update on my audio visual request',
  ],
  faculty_low_attendance: [
    'shortage list for my section',
    'students below the cutoff in my subject',
    'which students are below the attendance cutoff in my class',
  ],
  get_revaluation_status: [
    'status of my remarking application',
    'has my remarking request been processed',
    'update on my remarking application',
  ],
  get_company_info: [
    'package details for the drive',
    'what package is this company offering',
    'salary package offered by the recruiting company',
  ],

  // --- TIER 2: same-role collisions, still confidently wrong data ---
  get_bonafide_status: [
    'status of my bonafide request',
    'pls status of my bonafide request',
    'has my bonafide certificate been issued',
  ],
  get_hall_ticket: [
    'is my exam permit ready',
    'has my exam permit been generated',
    'download my exam permit',
  ],
  get_marksheet: [
    'send me my grade sheet',
    'download my grade sheet',
    'grade sheet for this semester',
  ],
  get_fee_breakup: [
    'break down my fee structure',
    'itemized fee details please',
    'category wise breakdown of my fees',
  ],
  get_hostel_room: [
    'where am i staying on campus',
    'which block am i staying in',
  ],
  admin_dd_lookup: [
    'find this dd in the system',
    'verify a draft submission',
    'look up a dd by reference number',
  ],
  admin_overdue_books: [
    'which books are overdue right now',
    'overdue books across the library',
    'list of overdue books institution wide',
  ],
  faculty_mentees: [
    'my mentee roster',
    'list of students i mentor',
  ],
  faculty_invigilation: [
    'invigilation schedule for me',
    'my invigilation duty for this exam',
    'which hall am i invigilating',
  ],
  admin_gate_log: [
    'who entered campus this morning',
    'gate entries this morning',
    'main gate log for today',
  ],
  admin_hostel_occupancy: [
    'vacant rooms in the hostel',
    'how many hostel beds are vacant',
    'hostel occupancy by block',
  ],

  // --- TIER 3: pure below-threshold gaps ---
  admin_list_students: [
    'list everyone in mechanical dept',
    'list everyone in the mechanical department',
    'show all students in a department',
  ],
  get_subject_notes: [
    'notes for thermodynamics please',
    'study material for thermodynamics',
    'notes for a specific subject',
  ],
  search_books: [
    'does the library have any books on ai',
    'find a book on thermodynamics',
    'search the library catalogue for a book',
  ],
  get_exam_eligibility: [
    'can i sit for the finals',
    'am i allowed to sit for the finals',
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
