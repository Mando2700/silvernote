import { describe, expect, it } from 'vitest';

import { decodeEntities, htmlToText } from '@/lib/data/entities';

describe('decodeEntities', () => {
  it('decodes hex, decimal and named references', () => {
    expect(decodeEntities('He&#x2019;s up &#8212; 5&nbsp;&amp; rising')).toBe('He’s up — 5 & rising');
  });
  it('leaves unknown references alone', () => {
    expect(decodeEntities('&bogus; &#xZZ;')).toBe('&bogus; &#xZZ;');
  });
  it('strips tags', () => {
    expect(htmlToText('<p>AT&amp;T <b>beats</b></p>')).toBe('AT&T beats');
  });
});
