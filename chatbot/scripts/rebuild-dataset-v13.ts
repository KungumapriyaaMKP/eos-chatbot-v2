/**
 * Thirteenth dataset pass -- fixes a real, emotionally significant bug
 * found via live screenshot: a student wrote "im worried, im afraid about
 * my attendace, how much leave can i take more" -- SBERT's OWN pick was
 * actually get_attendance (0.703, correct-ish domain), but the LLM
 * reranker OVERRODE it to get_leave_status (wrong -- that tracks discrete
 * leave APPLICATIONS, not attendance buffer), producing a cold, irrelevant
 * "You haven't submitted any leave requests." reply to a worried student
 * asking a real, anxious question about their attendance margin.
 *
 * Root cause: get_exam_eligibility (the intent that actually computes
 * attendance-buffer/threshold info -- current %, projected best/worst
 * case, how many MORE classes to attend to clear the threshold) had zero
 * examples framed as "how much can I still miss/skip/take as leave" -- only
 * the positive framing ("attend more classes"). The INVERSE framing (how
 * much absence budget remains) is the same underlying question but was
 * completely unanchored, so it fell through toward the unrelated
 * leave-status intent instead.
 *
 * Usage: npx tsx scripts/rebuild-dataset-v13.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type { IntentDataset, IntentDefinition } from '../src/intent/intent.types';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const CURRENT_JSON_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'intents.json');

const NEW_EXAMPLES: Record<string, string[]> = {
  get_exam_eligibility: [
    "im worried about my attendance, how much leave can i take more",
    'how many more classes can i afford to miss',
    'how much more leave can i take before i lose eligibility',
    'how many days can i still be absent and stay eligible',
    'whats the maximum leave i can take without affecting my eligibility',
    'how much attendance buffer do i have left',
    'im scared my attendance is too low, can i still miss classes',
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
    if (!intent) {
      console.warn(`Intent "${intentName}" not found -- skipping.`);
      continue;
    }
    const existingKeys = new Set(intent.examples.map((e) => e.toLowerCase()));
    for (const raw of examples) {
      const example = normalize(raw);
      const key = example.toLowerCase();
      if (existingKeys.has(key)) {
        console.warn(`  DUPLICATE for "${intentName}": "${example}" -- skipping.`);
        skippedDupes++;
        continue;
      }
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
