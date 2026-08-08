/**
 * Eighth dataset augmentation pass — found live: a student asking "how many
 * leaves can i take more" / "leave balance" scored higher against
 * faculty_leave_status (faculty-only) than get_leave_status (the actual
 * student-facing intent), because get_leave_status's examples were all
 * "did my leave get approved?" phrasing — nothing anchoring a
 * balance/count framing, which faculty_leave_status happens to have
 * ("my leave balance status"). Result: a student's own question got
 * classified into a faculty-only intent and wrongly RBAC-denied.
 *
 * get_leave_status also had no real handler wired up at all (fell through
 * to notWiredUp) — fixed separately in leave-status.service.ts.
 *
 * Usage: npx tsx scripts/augment-dataset-8.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const NEW_EXAMPLES: Record<string, string[]> = {
  get_leave_status: [
    'how many leaves can I take',
    'how many leaves can i take more',
    'how many leaves do I have left',
    'my leave balance',
    'leave balance',
    'how many leaves have I taken',
    'how many leave days have I used',
  ],
};

interface Paragraph {
  raw: string;
  style: string;
  text: string;
  start: number;
  end: number;
}

function extractParagraphs(xml: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[0];
    const styleMatch = raw.match(/<w:pStyle w:val="([^"]+)"/);
    const textMatches = [...raw.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    const text = textMatches.map((t) => t[1]).join('').trim();
    paragraphs.push({ raw, style: styleMatch ? styleMatch[1] : '', text, start: m.index, end: m.index + raw.length });
  }
  return paragraphs;
}

function buildListParagraph(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>` +
    `<w:spacing w:after="20"/></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t>${escaped}</w:t></w:r></w:p>`
  );
}

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(DOCX_PATH, BACKUP_PATH);
    console.log(`Backed up original to ${BACKUP_PATH}`);
  } else {
    console.log(`Backup already exists at ${BACKUP_PATH} (not overwritten).`);
  }

  const buffer = fs.readFileSync(DOCX_PATH);
  const zip = await JSZip.loadAsync(buffer);
  let xml = await zip.file('word/document.xml')!.async('text');

  const insertions: Array<{ at: number; xml: string }> = [];

  for (const [intentName, examples] of Object.entries(NEW_EXAMPLES)) {
    const paragraphs = extractParagraphs(xml);
    const headingIndex = paragraphs.findIndex((p) => p.style === 'Heading2' && p.text === intentName);
    if (headingIndex === -1) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }
    let boundaryIndex = paragraphs.length;
    for (let i = headingIndex + 1; i < paragraphs.length; i++) {
      if (paragraphs[i].style === 'Heading1' || paragraphs[i].style === 'Heading2') {
        boundaryIndex = i;
        break;
      }
    }
    const insertAt = boundaryIndex < paragraphs.length ? paragraphs[boundaryIndex].start : paragraphs[paragraphs.length - 1].end;
    insertions.push({ at: insertAt, xml: examples.map(buildListParagraph).join('') });
    console.log(`+ ${examples.length} examples queued for "${intentName}"`);
  }

  insertions.sort((a, b) => b.at - a.at);
  for (const { at, xml: insertXml } of insertions) {
    xml = xml.slice(0, at) + insertXml + xml.slice(at);
  }

  zip.file('word/document.xml', xml);
  const outBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(DOCX_PATH, outBuffer);

  console.log(`✔ Wrote ${DOCX_PATH}`);
}

main().catch((err) => {
  console.error('✖ Dataset augmentation failed:', err);
  process.exit(1);
});
