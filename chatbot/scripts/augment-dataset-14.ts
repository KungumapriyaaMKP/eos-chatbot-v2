/**
 * Fourteenth dataset augmentation pass — "which sem am i in" was landing on
 * get_my_subjects (0.705, nearest "which subjects am i studying this sem")
 * instead of get_profile, which is where semester info actually lives
 * (profile.service.ts now selects/reports current_semester too — this was
 * a real functional gap, not just a classifier one: get_profile never
 * queried current_semester at all until this same pass).
 *
 * Usage: npx tsx scripts/augment-dataset-14.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const NEW_EXAMPLES: Record<string, string[]> = {
  get_profile: ['which sem am i in', 'what sem am i in', 'which semester am i currently in'],
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
  const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(DOCX_PATH, outBuffer);

  console.log(`✔ Wrote ${DOCX_PATH}`);
}

main().catch((err) => {
  console.error('✖ Dataset augmentation failed:', err);
  process.exit(1);
});
