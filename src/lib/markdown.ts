import { Marked } from 'marked';

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Markdown → HTML for notes, theses and AI answers. Raw HTML in the source is shown as text,
 * links are limited to http(s)/mailto and images to https or inline raster data, so model output
 * can never inject markup or scripts.
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
    // Images: https URLs and inline PNG/JPEG/WebP data (chart snapshots pasted into notes). Never SVG,
    // which can carry script.
    image({ href, text, title }) {
      const safe = /^https:\/\//i.test(href) || /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(href);
      if (!safe) return escapeHtml(text ?? '');
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text ?? '')}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy" referrerpolicy="no-referrer" />`;
    },
  },
});

export function renderMarkdown(source: string) {
  return marked.parse(source ?? '', { async: false }) as string;
}
