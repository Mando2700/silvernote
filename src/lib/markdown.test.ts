import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@/lib/markdown';

describe('renderMarkdown', () => {
  it('renders https and raster data images', () => {
    expect(renderMarkdown('![chart](https://example.com/a.png)')).toContain('<img src="https://example.com/a.png"');
    expect(renderMarkdown('![snap](data:image/png;base64,iVBORw0KGgo=)')).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
  });
  it('refuses svg and javascript images and raw html', () => {
    expect(renderMarkdown('![x](data:image/svg+xml;base64,PHN2Zz4=)')).not.toContain('<img');
    expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('<img');
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
  });
});
