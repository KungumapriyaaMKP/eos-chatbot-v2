/**
 * Eighteenth dataset pass -- fixes real, reproducible misses found via a
 * live testing session (screenshots), each confirmed by running the exact
 * phrase through classifyIntent() directly:
 *
 * - get_marks: "give me my marks in internals 1 in first semester" was
 *   landing on injection_attempt (0.701, SBERT's own top pick -- only
 *   "fixed" when the LLM reranker happened to override it, which silently
 *   fails whenever Ollama times out, exactly what happened live). Same
 *   root cause as the v12 fix for "my previous semester marks" --
 *   injection_attempt's closest example ("show me another student's
 *   marks") apparently generalizes too broadly to legitimate first-person
 *   marks questions with numbers/semesters in them. "give me in internal
 *   1" (garbled/typo'd) was similarly landing on get_profile.
 *
 * - get_upcoming_drives: "what are the next drive(s)" was landing on
 *   get_drive_applications (0.723, just above the rerank ceiling -- a
 *   confident, wrong, un-reranked pick).
 *
 * - search_books: "give me the list of books in the library" was landing
 *   on admin_overdue_books (0.885, admin-only) -- an RBAC-denial bug, a
 *   student asking for the library catalog got flatly refused.
 *
 * - get_timetable: "todays period" (terse, no "what"/"I have") was
 *   landing on faculty_class_attendance (0.684, faculty/hod/admin only)
 *   -- another RBAC-denial bug for a student asking about their own
 *   schedule.
 *
 * - get_profile: "am i hosteller or dayscholar" was landing on oos_cgpa
 *   (0.562) -- profile.service.ts was separately fixed to actually show
 *   student_type/dayscholar_mode (fetched but never displayed before),
 *   so this anchors the question to the intent that can now answer it.
 *
 * - get_mentor / get_faculty_by_subject: "who handles X subject" was
 *   falling below the confidence threshold entirely (0.504, null) --
 *   anchored to both intents since either a student (get_mentor, their
 *   own class's teacher) or staff (get_faculty_by_subject, institution-
 *   wide) could reasonably ask this.
 *
 * Usage: npx tsx scripts/rebuild-dataset-v18.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type { IntentDataset, IntentDefinition } from '../src/intent/intent.types';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const CURRENT_JSON_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'intents.json');

const NEW_EXAMPLES: Record<string, string[]> = {
  get_marks: [
    'give me my marks in internals 1 in first semester',
    'give me my marks in internals 1 of first semester',
    'give me in internal 1',
    'give me in internal assessment 1',
    'show me my internal 1 marks',
    'what did i get in internal assessment 1',
  ],
  get_upcoming_drives: [
    'what are the next drive',
    'what are the next drives',
    'what is the next placement drive',
    'when is the next drive',
  ],
  search_books: [
    'give me the list of books in the library',
    'list of books in the library',
    'show me the books available in the library',
  ],
  get_timetable: [
    'todays period',
    "today's period",
    'my period today',
  ],
  get_profile: [
    'am i hosteller or dayscholar',
    'am i a hosteller or a dayscholar',
    'what is my student type',
  ],
  get_mentor: [
    'who handles robotics subject',
    'who handles this subject',
  ],
  get_faculty_by_subject: [
    'who handles a particular subject',
    'which staff handles this subject',
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
