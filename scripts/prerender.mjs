/**
 * Give every conversation a real page, and give crawlers the whole corpus.
 *
 * Runs after `vite build`, on top of dist/index.html, and writes:
 *
 *   dist/chat/<id>/index.html   the built app page, retitled for one
 *                               conversation, with the profile and the first
 *                               messages as plain HTML and a one-line script
 *                               that sets the hash so the app opens that chat
 *   dist/llms-full.txt          the site's text — about, profiles, highlights —
 *                               with a pointer to each conversation's Markdown
 *   dist/sitemap.xml            home, the 24 pages, the 24 Markdown exports
 *
 * The router keeps its hash routes; nothing in the app changes. A crawler that
 * runs no JavaScript reads the article. A browser runs the app, which removes
 * the article as its first act.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getContactProfile, VORCARO_PROFILE, SOURCES } from '../src/lib/profile-content.js';
import { SETTINGS_CONTENT } from '../src/lib/settings-content.js';
import {
  ROOT, SITE, REPO, TIMEZONE, UTC_OFFSET,
  loadEntries, loadMessages, sourceOf, contactOf, whoIs, createResolver,
  urlsIn, linksToMarkdown, linksToText, linksToHtml, escapeHtml,
  longDate, phonePretty, messageText,
} from './lib/corpus.mjs';

const DIST = join(ROOT, 'dist');
const templatePath = join(DIST, 'index.html');
if (!existsSync(templatePath)) {
  console.error('dist/index.html not found — run `vite build` first');
  process.exit(1);
}
const template = readFileSync(templatePath, 'utf-8');
const today = new Date().toISOString().slice(0, 10);
const entries = loadEntries();
const resolve = createResolver(entries);

/** Martha's 65k would make a page nobody should have to download. */
const PREVIEW_MESSAGES = 200;

function reportDoc(source) {
  const doc = {
    '@type': 'DigitalDocument',
    name: 'IPJ-A nº 3298613/2026 — Polícia Federal',
    description: 'Informação de Polícia Judiciária de Análise sobre o iPhone apreendido de Daniel Vorcaro; sigilo levantado em 1º de setembro de 2026.',
    datePublished: '2026-08-27',
  };
  if (source.document_pages) doc.numberOfPages = source.document_pages;
  if (source.document_url) doc.url = source.document_url;
  if (source.document_sha256) {
    doc.identifier = { '@type': 'PropertyValue', propertyID: 'sha256', value: source.document_sha256 };
  }
  return doc;
}

// ── per-conversation page ──────────────────────────────────────────────────

/** A description a search result can show, from the profile when there is one. */
function describe(entry, profile, who) {
  const first = profile?.sections?.[0]?.paragraphs?.[0]?.text;
  const fallback = `Conversa entre Daniel Vorcaro e ${who}: ${entry.total_messages} mensagens, de ${entry.date_range.start} a ${entry.date_range.end}, no MasterWhats.`;
  if (!first) return fallback;
  const text = linksToText(first).replace(/\s+/g, ' ').trim();
  if (text.length <= 155) return text;
  return `${text.slice(0, 155).replace(/\s+\S*$/, '')}…`;
}

function jsonLd(entry, who, description) {
  const url = `${SITE}/chat/${entry.id}`;
  const source = sourceOf(entry);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Conversation',
    '@id': url,
    name: `Daniel Vorcaro ↔ ${who}`,
    url,
    inLanguage: 'pt-BR',
    description,
    temporalCoverage: `${entry.date_range.start}/${entry.date_range.end}`,
    about: [
      { '@type': 'Person', name: 'Daniel Vorcaro' },
      { '@type': 'Person', name: who },
    ],
    isPartOf: { '@id': `${SITE}/#dataset` },
    encoding: [
      { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: `${SITE}/export/masterwhats-${entry.id}.md` },
      { '@type': 'MediaObject', encodingFormat: 'application/json', contentUrl: `${SITE}/export/masterwhats-${entry.id}.json` },
    ],
    dateModified: today,
  };
  if (source.kind === 'police-report') data.isBasedOn = reportDoc(source);
  return JSON.stringify(data, null, 2);
}

function article(entry, messages, profile, who) {
  const source = sourceOf(entry);
  const shown = messages.slice(0, PREVIEW_MESSAGES);
  const out = [];

  out.push(`<article id="prerender">`);
  out.push(`<h1>Daniel Vorcaro ↔ ${escapeHtml(who)}</h1>`);
  out.push(`<p>${entry.total_messages} mensagens, de ${entry.date_range.start} a ${entry.date_range.end}. `
    + `<a href="/#/chat/${entry.id}">Abrir no MasterWhats</a> · `
    + `<a href="/export/masterwhats-${entry.id}.md">Markdown completo</a> · `
    + `<a href="/export/masterwhats-${entry.id}.json">JSON</a></p>`);

  out.push('<h2>Proveniência</h2><dl>');
  out.push(`<dt>Fonte</dt><dd>${escapeHtml(source.label)}</dd>`);
  if (source.document) out.push(`<dt>Documento</dt><dd>${source.document_url ? `<a href="${escapeHtml(source.document_url)}" rel="noopener">${escapeHtml(source.document)}</a>` : escapeHtml(source.document)}${source.document_pages ? `, ${source.document_pages} páginas` : ''} (no repositório; o site não serve o PDF)</dd>`);
  if (source.document_sha256) out.push(`<dt>sha256 do documento</dt><dd><code>${source.document_sha256}</code></dd>`);
  out.push(`<dt>Como chegou ao público</dt><dd>${escapeHtml(source.how)}</dd>`);
  if (entry.saved_as) out.push(`<dt>Contato salvo como</dt><dd>${escapeHtml(entry.saved_as)}</dd>`);
  if (entry.phone) out.push(`<dt>Telefone</dt><dd>${escapeHtml(phonePretty(entry.phone))}</dd>`);
  out.push(`<dt>Fuso dos horários</dt><dd>${TIMEZONE} (UTC${UTC_OFFSET})</dd>`);
  if (entry.note) out.push(`<dt>Observação</dt><dd>${escapeHtml(entry.note)}</dd>`);
  out.push('</dl>');

  const urls = [];
  if (profile) {
    out.push(`<h2>Quem é ${escapeHtml(who)}</h2>`);
    for (const section of profile.sections || []) {
      if (section.title && section.title !== who && section.title !== `Sobre ${who}`) {
        out.push(`<h3>${escapeHtml(section.title)}</h3>`);
      }
      for (const p of section.paragraphs || []) {
        urls.push(...urlsIn(p.text));
        out.push(`<p>${linksToHtml(p.text, { resolve, context: entry.id, samePage: entry.id })}</p>`);
      }
    }
  }

  out.push(`<h2>Conversa${shown.length < messages.length ? ` (primeiras ${shown.length} mensagens)` : ''}</h2>`);
  let day = null;
  for (const msg of shown) {
    if (msg.date !== day) {
      day = msg.date;
      out.push(`<h3>${longDate(day)}</h3>`);
    }
    const cite = msg.source_page ? ` <small>(laudo p. ${msg.source_page}${msg.source_figure ? `, fig. ${msg.source_figure}` : ''})</small>` : '';
    out.push(`<p id="msg-${msg.id}"><time datetime="${msg.timestamp}${UTC_OFFSET}">${msg.time.slice(0, 5)}</time> <b>${escapeHtml(msg.sender)}</b>: ${escapeHtml(messageText(msg))}${cite}</p>`);
  }
  if (shown.length < messages.length) {
    out.push(`<p>As outras ${messages.length - shown.length} mensagens estão no <a href="/export/masterwhats-${entry.id}.md">Markdown completo</a> e <a href="/#/chat/${entry.id}">no app</a>.</p>`);
  }

  const sources = [...new Set(urls)];
  if (sources.length) {
    out.push('<h2>Fontes</h2><ul>');
    for (const u of sources) out.push(`<li><a href="${escapeHtml(u)}" rel="noopener">${escapeHtml(u)}</a></li>`);
    out.push('</ul>');
  }
  out.push('</article>');
  return out.join('\n');
}

function page(entry, messages) {
  const profile = getContactProfile(entry.id);
  const who = whoIs(entry, profile);
  const title = `Daniel Vorcaro ↔ ${who} — MasterWhats`;
  const description = describe(entry, profile, who);
  const url = `${SITE}/chat/${entry.id}`;
  const attr = (s) => escapeHtml(s);

  let html = template;
  const swap = (re, replacement) => {
    if (!re.test(html)) throw new Error(`template lost ${re}`);
    html = html.replace(re, replacement);
  };
  swap(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`);
  swap(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(description)}">`);
  swap(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  swap(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(title)}">`);
  swap(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(description)}">`);
  swap(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
  swap(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(title)}">`);
  swap(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(description)}">`);

  // The home page's structured data does not describe this page.
  html = html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  swap(/<\/head>/, `<script type="application/ld+json">\n${jsonLd(entry, who, description)}\n</script>\n`
    + `<script>if(!location.hash)location.replace('#/chat/${entry.id}')</script>\n</head>`);

  swap(/\s*<noscript>/, `\n${article(entry, messages, profile, who)}\n<noscript>`);
  return html;
}

// ── llms-full.txt ──────────────────────────────────────────────────────────

function profileParagraphs(profile, context) {
  const out = [];
  for (const section of profile?.sections || []) {
    if (section.title) out.push(`**${section.title}**`, '');
    for (const p of section.paragraphs || []) out.push(linksToMarkdown(p.text, { resolve, context }), '');
  }
  return out;
}

function llmsFull(built) {
  const total = built.reduce((n, b) => n + b.entry.total_messages, 0);
  const about = SETTINGS_CONTENT.sections.find(s => s.title === 'Sobre o Projeto');
  const rest = SETTINGS_CONTENT.sections.filter(s => s !== about);
  const out = [
    '# MasterWhats — conteúdo completo', '',
    `> Tudo que o site diz, em texto. Cada citação traz ⟨data hora · laudo p., fig.⟩ e linka a mensagem: o link do app é ${SITE}/#/chat/<id>/msg/<n>, e o mesmo n aparece como "msg n" no Markdown de cada conversa. ${built.length} conversas, ${total} mensagens, de ${built.at(-1)?.entry.date_range.start ?? ''} a ${built[0]?.entry.date_range.end ?? ''}. Gerado em ${today}. Código e dados: ${REPO}.`, '',
    '## Sobre o projeto', '',
    ...(about?.paragraphs || []).map(p => linksToMarkdown(p.text, { resolve }) + '\n'),
    '## Quem é Daniel Vorcaro', '',
    ...profileParagraphs(VORCARO_PROFILE, 'martha-graeff'),
    `## Conversas (${built.length})`, '',
  ];
  for (const { entry, who, profile } of built) {
    const source = sourceOf(entry);
    out.push(`### ${who} — ${entry.total_messages} mensagens, ${entry.date_range.start} a ${entry.date_range.end}`, '');
    out.push(`- Página: ${SITE}/chat/${entry.id}`);
    out.push(`- Conversa completa em Markdown: ${SITE}/export/masterwhats-${entry.id}.md · JSON: ${SITE}/export/masterwhats-${entry.id}.json`);
    out.push(`- Fonte: ${source.label}`);
    if (entry.saved_as) out.push(`- Salvo no celular como: ${entry.saved_as}`);
    if (entry.note) out.push(`- Observação: ${entry.note}`);
    out.push('');
    out.push(...profileParagraphs(profile, entry.id));
  }
  for (const section of rest) {
    out.push(`## ${section.title}`, '');
    for (const p of section.paragraphs) out.push(linksToMarkdown(p.text, { resolve }), '');
  }
  out.push('## Fontes gerais', '', ...SOURCES.map(s => `- [${s.label}](${s.url})`), '');
  out.push('## Export', '',
    'Comece pelo arquivo de uma conversa (7 a 40 KB, links acima); os consolidados são grandes e raramente necessários.',
    `- Zip com tudo: ${SITE}/export/masterwhats-export.zip (3 MB)`,
    `- Tudo em Markdown: ${SITE}/export/masterwhats.md (3 MB)`,
    `- Tudo em JSON: ${SITE}/export/masterwhats.json (14 MB)`, '');
  return out.join('\n');
}

// ── sitemap ────────────────────────────────────────────────────────────────

function sitemap(built) {
  const url = (loc, priority, changefreq = 'weekly') =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  const rows = [url(`${SITE}/`, '1.0')];
  for (const { entry } of built) {
    const headline = entry.id === 'alexandre-de-moraes' || entry.id === 'martha-graeff';
    rows.push(url(`${SITE}/chat/${entry.id}`, headline ? '0.9' : '0.8'));
  }
  rows.push(url(`${SITE}/llms.txt`, '0.7'));
  rows.push(url(`${SITE}/llms-full.txt`, '0.7'));
  rows.push(url(`${SITE}/export/masterwhats.md`, '0.6', 'monthly'));
  for (const { entry } of built) rows.push(url(`${SITE}/export/masterwhats-${entry.id}.md`, '0.5', 'monthly'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

// ── run ────────────────────────────────────────────────────────────────────

const built = [];
for (const entry of entries) {
  const messages = loadMessages(entry);
  const profile = getContactProfile(entry.id);
  const who = whoIs(entry, profile);
  const dir = join(DIST, 'chat', entry.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(entry, messages));
  built.push({ entry, who, profile });
  console.log(`chat/${entry.id}/ — ${who}`);
}
// The sizes the index quotes decide whether a crawler downloads a file. They
// are stamped from the files themselves rather than typed and forgotten.
const mb = (name) => `${(statSync(join(DIST, 'export', name)).size / 1048576).toFixed(1)} MB`;
const SIZES = { 'masterwhats.md': mb('masterwhats.md'), 'masterwhats.json': mb('masterwhats.json'), 'masterwhats-export.zip': mb('masterwhats-export.zip') };
const stampSizes = (text) => text.replace(/(masterwhats(?:-export)?\.(?:md|json|zip)) \([\d.,]+ MB\)/g, (m, name) => `${name} (${SIZES[name] || m.slice(name.length + 2, -1)})`);
writeFileSync(join(DIST, 'llms.txt'), stampSizes(readFileSync(join(DIST, 'llms.txt'), 'utf-8')));
writeFileSync(join(DIST, 'llms-full.txt'), stampSizes(llmsFull(built)));
writeFileSync(join(DIST, 'sitemap.xml'), sitemap(built));
console.log(`\nDone! ${built.length} pages, llms-full.txt, sitemap.xml → ${DIST}`);
