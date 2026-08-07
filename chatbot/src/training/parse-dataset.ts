/**
 * One-time (re-run whenever the dataset .docx changes) training step:
 *
 *   EOS_Intent_Training_Dataset_English_Only.docx  →  src/embeddings/intents.json
 *
 * The dataset is a Word document, not free text — it's structured as
 * Heading1 (module, e.g. "Student - exams") > Heading2 (intent name, e.g.
 * "get_marks") > a "roles: student, admin" line > a one-line description >
 * an "examples (N):" marker > a bulleted (ListParagraph) list of example
 * user utterances. This script walks that structure directly rather than
 * guessing from plain text, so it's exact.
 *
 * Usage:  npm run train:parse
 *         (or) tsx src/training/parse-dataset.ts [path-to-docx]
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { IntentDataset, IntentDefinition } from '../intent/intent.types';

const DEFAULT_DATASET_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'EOS_Intent_Training_Dataset_English_Only.docx',
);

const OUTPUT_PATH = path.join(__dirname, '..', 'embeddings', 'intents.json');

interface RawParagraph {
  style: string; // '' for body/normal text
  text: string;
}

async function extractParagraphs(docxPath: string): Promise<RawParagraph[]> {
  const buffer = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(buffer);
  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) {
    throw new Error(`${docxPath} does not look like a valid .docx (missing word/document.xml)`);
  }
  const xml = await documentXmlFile.async('text');

  const bodyMatch = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;

  // Word paragraphs never nest, so a non-greedy <w:p ...>...</w:p> match is safe here.
  const paragraphBlocks: string[] = body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];

  return paragraphBlocks.map((block) => {
    const styleMatch = block.match(/<w:pStyle w:val="([^"]+)"/);
    const style = styleMatch ? styleMatch[1] : '';

    const textMatches = [...block.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    const text = textMatches.map((m) => m[1]).join('').trim();

    return { style, text };
  });
}

function normalizeExample(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function parseRolesLine(text: string): string[] {
  const match = text.match(/^roles:\s*(.+)$/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

function buildIntents(paragraphs: RawParagraph[]): IntentDefinition[] {
  const intents: IntentDefinition[] = [];
  let currentModule = '';
  let current: IntentDefinition | null = null;
  let seenExamplesMarker = false;
  const seenExamplesSet = new Set<string>();

  const flush = () => {
    if (current && current.name) {
      intents.push(current);
    }
    current = null;
    seenExamplesMarker = false;
    seenExamplesSet.clear();
  };

  for (const p of paragraphs) {
    if (p.style === 'Heading1') {
      flush();
      currentModule = p.text;
      continue;
    }

    if (p.style === 'Heading2') {
      flush();
      current = { name: p.text, module: currentModule, roles: [], description: '', examples: [] };
      continue;
    }

    if (!current) continue; // front-matter / "Intent summary" legend section, no intent yet

    if (!p.text) continue;

    if (/^examples\s*\(/i.test(p.text)) {
      seenExamplesMarker = true;
      continue;
    }

    if (p.style === 'ListParagraph') {
      const example = normalizeExample(p.text);
      const key = example.toLowerCase();
      if (example && !seenExamplesSet.has(key)) {
        seenExamplesSet.add(key);
        current.examples.push(example);
      }
      continue;
    }

    // Plain paragraph, not yet in the examples list.
    if (!seenExamplesMarker) {
      const roles = parseRolesLine(p.text);
      if (roles.length > 0) {
        current.roles = roles;
      } else {
        current.description = current.description ? `${current.description} ${p.text}` : p.text;
      }
    }
  }
  flush();

  return intents;
}

async function main() {
  const docxPath = process.argv[2] || DEFAULT_DATASET_PATH;

  if (!fs.existsSync(docxPath)) {
    console.error(`✖ Dataset not found at: ${docxPath}`);
    console.error('  Pass an explicit path: tsx src/training/parse-dataset.ts <path-to-docx>');
    process.exit(1);
  }

  console.log(`Reading dataset: ${docxPath}`);
  const paragraphs = await extractParagraphs(docxPath);
  console.log(`Parsed ${paragraphs.length} paragraphs from the document.`);

  const intents = buildIntents(paragraphs);

  const warnings: string[] = [];
  for (const intent of intents) {
    if (intent.roles.length === 0) warnings.push(`"${intent.name}" has no roles: line`);
    if (intent.examples.length === 0) warnings.push(`"${intent.name}" has zero examples`);
  }
  if (warnings.length > 0) {
    console.warn(`⚠ ${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }

  const totalExamples = intents.reduce((sum, i) => sum + i.examples.length, 0);

  const dataset: IntentDataset = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(docxPath),
    totalIntents: intents.length,
    totalExamples,
    intents,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2), 'utf-8');

  console.log(`✔ Parsed ${intents.length} intents, ${totalExamples} examples.`);
  console.log(`✔ Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('✖ Dataset parsing failed:', err);
  process.exit(1);
});
