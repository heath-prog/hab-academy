// Import the HAB Master Curriculum HTML into the app.
//
//   node scripts/import-curriculum.mjs <path-to-master.htm> [path-to-hab-curriculum.json]
//
// Splits the single-file curriculum into per-chapter JSON under content/curriculum/
// (one file per chapter, sections split on <h3>) and writes a scoped stylesheet to
// public/curriculum.css so the original design renders inside the Academy layout.
//
// The generated files are committed to the repo — the app never needs the source
// HTM at runtime. Re-run this script only when the master curriculum is updated.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'content', 'curriculum');
const CSS_OUT = path.join(__dirname, '..', 'public', 'curriculum.css');

const htmPath = process.argv[2];
const jsonPath = process.argv[3] || null;
if (!htmPath || !fs.existsSync(htmPath)) {
  console.error('Usage: node scripts/import-curriculum.mjs <master.htm> [hab-curriculum.json]');
  process.exit(1);
}
const html = fs.readFileSync(htmPath, 'utf8');

// Optional machine-readable companion (module objectives / KPIs for card subtitles)
let corpus = null;
if (jsonPath && fs.existsSync(jsonPath)) {
  corpus = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Chapter map. `moduleKey` (M1-M9) marks trackable training modules;
// everything else is reference reading. `coachOnly` gates coach infrastructure.
// ---------------------------------------------------------------------------
const CHAPTERS = [
  { id: 'map',           slug: 'start-here',   kind: 'ref',    coachOnly: false },
  { id: 'foundation',    slug: 'foundation',   kind: 'ref',    coachOnly: false },
  { id: 'm1',            slug: 'm1', moduleKey: 'M1', kind: 'module' },
  { id: 'm2',            slug: 'm2', moduleKey: 'M2', kind: 'module' },
  { id: 'm3',            slug: 'm3', moduleKey: 'M3', kind: 'module' },
  { id: 'm4',            slug: 'm4', moduleKey: 'M4', kind: 'module' },
  { id: 'm5',            slug: 'm5', moduleKey: 'M5', kind: 'module' },
  { id: 'm6',            slug: 'm6', moduleKey: 'M6', kind: 'module' },
  { id: 'm7',            slug: 'm7', moduleKey: 'M7', kind: 'module' },
  { id: 'm8',            slug: 'm8', moduleKey: 'M8', kind: 'module' },
  { id: 'm9',            slug: 'm9', moduleKey: 'M9', kind: 'module' },
  { id: 'coach',         slug: 'coach-os',     kind: 'ref', coachOnly: true },
  { id: 'plan90',        slug: 'plan-90',      kind: 'ref', coachOnly: true },
  { id: 'toolkit',       slug: 'how-to-coach', kind: 'ref', coachOnly: true },
  { id: 'library',       slug: 'examples',     kind: 'ref', coachOnly: false },
  { id: 'concept-index', slug: 'glossary',     kind: 'ref', coachOnly: false },
];

const ANCHOR_MAP = Object.fromEntries(CHAPTERS.map(c => [c.id, `/curriculum/${c.slug}`]));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&middot;/g, '·').replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘').replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“').replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
function slugify(s) {
  return stripTags(s).toLowerCase()
    .replace(/[‘’'"“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}
function cleanHtml(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/href="#([a-z0-9-]+)"/gi, (m, id) => ANCHOR_MAP[id] ? `href="${ANCHOR_MAP[id]}"` : m);
}

// ---------------------------------------------------------------------------
// 1. Scoped stylesheet — prefix every selector with .curric so the master
//    curriculum design renders inside the Academy layout without clashes.
// ---------------------------------------------------------------------------
function scopeCss(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments (may contain braces)
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const selector = css.slice(i, brace).trim();
    if (selector.startsWith('@media')) {
      let depth = 1, j = brace + 1;
      while (j < n && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      out += `${selector} {\n${scopeCss(css.slice(brace + 1, j - 1), scope)}}\n`;
      i = j;
    } else if (selector.startsWith('@')) { // @keyframes / @font-face — verbatim
      let depth = 1, j = brace + 1;
      while (j < n && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      out += css.slice(i, j) + '\n';
      i = j;
    } else {
      const close = css.indexOf('}', brace);
      const body = css.slice(brace + 1, close);
      const scoped = selector.split(',').map(sel => {
        sel = sel.trim();
        if (!sel) return null;
        if (sel === ':root' || sel === 'html' || sel === 'body') return scope;
        if (sel.startsWith('html ') || sel.startsWith('body ')) return scope + sel.slice(4);
        return `${scope} ${sel}`;
      }).filter(Boolean).join(',\n');
      if (scoped) out += `${scoped} {${body}}\n`;
      i = close + 1;
    }
  }
  return out;
}

const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
if (!styleMatch) { console.error('No <style> block found in master HTM.'); process.exit(1); }
fs.mkdirSync(path.dirname(CSS_OUT), { recursive: true });
fs.writeFileSync(CSS_OUT,
  '/* GENERATED by scripts/import-curriculum.mjs - do not edit by hand.\n' +
  '   Original styles from the HAB Master Curriculum, scoped under .curric */\n' +
  scopeCss(styleMatch[1], '.curric'));
console.log(`ok: wrote ${path.relative(process.cwd(), CSS_OUT)}`);

// ---------------------------------------------------------------------------
// 2. Chapters
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

const corpusByModule = {};
if (corpus) {
  for (const s of corpus.process_steps || []) corpusByModule[s.module] = s;
  if (corpus.recovery_module) corpusByModule[corpus.recovery_module.module] = corpus.recovery_module;
}

const index = [];
for (const ch of CHAPTERS) {
  const re = new RegExp(`<section[^>]*id="${ch.id}"[^>]*>([\\s\\S]*?)</section>`, 'i');
  const m = html.match(re);
  if (!m) { console.error(`MISSING: section #${ch.id} not found - skipped`); continue; }
  let body = cleanHtml(m[1]);

  // Chapter title from its <h2>
  const h2 = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const title = h2 ? stripTags(h2[1]) : ch.slug;

  // Split on <h3> into trackable sections; content before first <h3> is the intro.
  const h3re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  const marks = [];
  let hm;
  while ((hm = h3re.exec(body)) !== null) {
    marks.push({ start: hm.index, end: hm.index + hm[0].length, title: stripTags(hm[1]) });
  }
  const intro = marks.length ? body.slice(0, marks[0].start) : body;
  const sections = [];
  const seen = new Set();
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : body.length;
    let slug = slugify(mk.title);
    while (seen.has(slug)) slug += '-2';
    seen.add(slug);
    sections.push({ slug, title: mk.title, html: body.slice(mk.start, end).trim() });
  });

  const meta = ch.moduleKey ? corpusByModule[ch.moduleKey] : null;
  const chapter = {
    slug: ch.slug,
    kind: ch.kind,
    moduleKey: ch.moduleKey || null,
    coachOnly: !!ch.coachOnly,
    title,
    objective: meta?.objective || null,
    primaryKpi: meta ? `${meta.primary_kpi}${meta.primary_kpi_target ? ' - target ' + meta.primary_kpi_target : ''}` : null,
    intro: intro.trim(),
    sections,
  };
  fs.writeFileSync(path.join(OUT_DIR, `${ch.slug}.json`), JSON.stringify(chapter, null, 1));
  index.push({
    slug: ch.slug, kind: ch.kind, moduleKey: ch.moduleKey || null, coachOnly: !!ch.coachOnly,
    title, objective: chapter.objective, primaryKpi: chapter.primaryKpi,
    sectionCount: sections.length,
  });
  console.log(`ok: ${ch.slug} "${title}" - ${sections.length} sections${ch.moduleKey ? ` [${ch.moduleKey}]` : ''}`);
}

fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: path.basename(htmPath),
  chapters: index,
}, null, 1));
console.log(`ok: wrote index.json (${index.length} chapters)`);
