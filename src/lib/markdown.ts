import { Marked } from 'marked';

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Markdown → HTML for notes, theses and AI answers. Raw HTML in the source is shown as text and
 * links are limited to http(s)/mailto, so model output can never inject markup or scripts.
 */
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const safe = /^(https?:|mailto:)/i.test(href) ? href : null;
      if (!safe) return text;
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>`;
    },
    image({ text }) {
      return escapeHtml(text ?? '');
    },
  },
});

export function renderMarkdown(source: string) {
  return marked.parse(source ?? '', { async: false }) as string;
}
