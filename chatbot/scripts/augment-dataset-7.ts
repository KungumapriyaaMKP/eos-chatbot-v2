/**
 * Seventh dataset augmentation pass — found live: "give me the classes
 * handled by the Bala Murugan" scored below the confidence threshold
 * entirely (no intent matched), because faculty_my_classes only ever had
 * self-referential examples ("what classes do I teach") — nothing anchoring
 * an admin/hod naming a SPECIFIC colleague, a real, needed capability
 * that resolveFacultyByFreeText (faculty-lookup.util.ts) now supports in
 * code. Also grants 'admin' the intent itself — it was faculty/hod only,
 * so even with the right classification an admin asking this would have
 * been RBAC-denied.
 *
 * Usage: npx tsx scripts/augment-dataset-7.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const ROLE_UPDATES: Record<string, string[]> = {
  faculty_my_classes: ['faculty', 'hod', 'admin'],
};

const NEW_EXAMPLES: Record<string, string[]> = {
  faculty_my_classes: [
    'classes handled by Bala Murugan',
    'give me the classes handled by Bala Murugan',
    'which classes does Bala Murugan teach',
    'what subjects does Priya Elango handle',
    'show classes taught by a faculty member',
    'classes assigned to a professor by name',
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

function rewriteRolesParagraph(raw: string, newRolesLine: string): string {
  let isFirst = true;
  let replaced = false;
  const rewritten = raw.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (_full, attrs) => {
    replaced = true;
    const text = isFirst ? newRolesLine : '';
    isFirst = false;
    return `<w:t${attrs || ''}>${text}</w:t>`;
  });
  if (!replaced) throw new Error('No <w:t> found in roles paragraph to rewrite');
  return rewritten;
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

function findIntentBounds(paragraphs: Paragraph[], intentName: string): { headingIndex: number; boundaryIndex: number } | null {
  const headingIndex = paragraphs.findIndex((p) => p.style === 'Heading2' && p.text === intentName);
  if (headingIndex === -1) return null;
  let boundaryIndex = paragraphs.length;
  for (let i = headingIndex + 1; i < paragraphs.length; i++) {
    if (paragraphs[i].style === 'Heading1' || paragraphs[i].style === 'Heading2') {
      boundaryIndex = i;
      break;
    }
  }
  return { headingIndex, boundaryIndex };
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

  for (const [intentName, roles] of Object.entries(ROLE_UPDATES)) {
    const paragraphs = extractParagraphs(xml);
    const bounds = findIntentBounds(paragraphs, intentName);
    if (!bounds) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }
    const { headingIndex, boundaryIndex } = bounds;
    const rolesParaIndex = paragraphs.findIndex((p, i) => i > headingIndex && i < boundaryIndex && /^roles:\s*/i.test(p.text));
    if (rolesParaIndex === -1) {
      console.warn(`⚠ No roles: line found for "${intentName}" — skipping.`);
      continue;
    }
    const para = paragraphs[rolesParaIndex];
    const newLine = `roles: ${roles.join(', ')}`;
    const newRaw = rewriteRolesParagraph(para.raw, newLine);
    xml = xml.slice(0, para.start) + newRaw + xml.slice(para.end);
    console.log(`✔ roles "${intentName}": "${para.text}" -> "${newLine}"`);
  }

  const insertions: Array<{ at: number; xml: string }> = [];
  for (const [intentName, examples] of Object.entries(NEW_EXAMPLES)) {
    const paragraphs = extractParagraphs(xml);
    const bounds = findIntentBounds(paragraphs, intentName);
    if (!bounds) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }
    const { boundaryIndex } = bounds;
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
