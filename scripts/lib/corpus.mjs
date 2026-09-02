/**
 * What the build scripts share: where the conversations are, how to read them
 * and how the site's content links turn into plain Markdown or HTML.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = join(ROOT, 'data');
export const PUBLIC_DATA = join(ROOT, 'public/data');

export const SITE = 'https://www.masterwhats.com.br';
export const REPO = 'https://github.com/rafaelbressan/masterzap';

// The phones were seized in Brazil and every timestamp in the sources is local
// wall-clock time. Brazil has had no daylight saving since 2019, so from the
// first message (December 2023) on the offset is a constant.
export const TIMEZONE = 'America/Sao_Paulo';
export const UTC_OFFSET = '-03:00';

export const REPORT_PDF = 'data/source/IPJ-A-3298613-2026.pdf';

/** The conversations as the site lists them, newest first. */
export function loadEntries() {
  return JSON.parse(readFileSync(join(PUBLIC_DATA, 'conversations.json'), 'utf-8')).conversations;
}

/** The Martha export is the one source without a per-conversation file. */
export function loadMessages(entry) {
  const fromReport = join(DATA_DIR, 'conversations', `${entry.id}.json`);
  if (existsSync(fromReport)) {
    return JSON.parse(readFileSync(fromReport, 'utf-8')).messages;
  }
  return JSON.parse(readFileSync(join(DATA_DIR, 'messages.json'), 'utf-8')).messages;
}

/** Where a conversation's text came from, in the terms the reader will need. */
export function sourceOf(entry, reportSha) {
  if (entry.source?.startsWith('IPJ-A')) {
    return {
      kind: 'police-report',
      label: entry.source,
      document: REPORT_PDF,
      document_sha256: reportSha || null,
      made_public: '2026-09-01',
      how: 'Transcrição manual das imagens do laudo; cada mensagem cita a página e a figura de origem.',
    };
  }
  return {
    kind: 'leak',
    label: 'Vazamento das conversas com Martha Graeff, março de 2026',
    document: null,
    document_sha256: null,
    made_public: '2026-03',
    how: 'Export de WhatsApp extraído do celular apreendido, vazado para a imprensa.',
  };
}

export const contactOf = (entry) => entry.participants.find(p => p !== 'DV') || entry.participants[0];

/** The person, as opposed to the name the phone saved them under. */
export const whoIs = (entry, profile) =>
  profile?.name || profile?.sections?.[0]?.title?.replace(/^Sobre /, '') || contactOf(entry);

export const urlsIn = (text) => [...text.matchAll(/\{[^}]+\}\[(https?:\/\/[^\]]+)\]/g)].map(m => m[1]);

/** The site's {text}[url] links as Markdown; action: links become plain text. */
export const linksToMarkdown = (text) => text.replace(/\{([^}]+)\}\[([^\]]+)\]/g,
  (_, t, url) => (url.startsWith('action:') ? t : `[${t}](${url})`));

/** The same links as plain text, for descriptions. */
export const linksToText = (text) => text.replace(/\{([^}]+)\}\[[^\]]+\]/g, '$1');

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The site's links as HTML; the text is escaped, the URLs are the site's own. */
export const linksToHtml = (text) => {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/\{([^}]+)\}\[([^\]]+)\]/g)) {
    out += escapeHtml(text.slice(last, m.index));
    const [, t, url] = m;
    out += url.startsWith('action:')
      ? escapeHtml(t)
      : `<a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(t)}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
export const longDate = (iso) => dateFmt.format(new Date(`${iso}T12:00:00`));

export const phonePretty = (p) => (p && /^55\d{10,11}$/.test(p)
  ? `+55 ${p.slice(2, 4)} ${p.slice(4, -4)}-${p.slice(-4)}`
  : p || null);

export const MEDIA = {
  image: 'Foto', video: 'Vídeo', audio: 'Áudio', sticker: 'Sticker',
  document: 'Documento', call: 'Chamada', deleted: 'Mensagem apagada', system: 'Sistema',
};

/** One message as plain text, media and system events in brackets. */
export function messageText(msg) {
  const text = (msg.content || '').trim();
  switch (msg.type) {
    case 'text': return text;
    case 'document': return `[Documento${msg.attachment ? `: ${msg.attachment}` : ''}]${text ? ` ${text}` : ''}`;
    case 'image':
      if (text.startsWith('[')) return text;
      return `[Foto]${text ? ` ${text}` : ''}`;
    case 'video': case 'audio': case 'sticker': return `[${MEDIA[msg.type]}]${text ? ` ${text}` : ''}`;
    case 'call': return `[${text || 'Chamada'}]`;
    case 'deleted': return `[${text || 'Mensagem apagada'}]`;
    case 'system': return `(${text})`;
    default: return text;
  }
}
