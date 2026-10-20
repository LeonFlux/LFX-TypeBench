import { describe, expect, it } from 'vitest';
import { chooseTheme, themesIn } from '../../src/services/theme.ts';

function sheet(...selectors: string[]) {
  return { cssRules: selectors.map((selectorText) => ({ selectorText })) } as unknown as CSSStyleSheet;
}

describe('Golden', () => {
  it('finds the themes a stylesheet defines', () => {
    expect(themesIn([sheet(':root', '[data-theme=pastel]', '.btn', '[data-theme="night"]')])).toEqual([
      'pastel',
      'night',
    ]);
  });

  it('applies the first theme found when none is chosen yet', () => {
    expect(chooseTheme(['pastel', 'night'], null)).toBe('pastel');
  });
});

describe('Edge', () => {
  it('keeps a theme that is already set and still defined', () => {
    expect(chooseTheme(['pastel', 'night'], 'night')).toBe('night');
  });

  it('replaces a theme that is no longer defined', () => {
    expect(chooseTheme(['pastel'], 'fantasy')).toBe('pastel');
  });

  it('leaves the page alone when no theme is defined', () => {
    expect(chooseTheme([], null)).toBeNull();
  });

  it('skips stylesheets it cannot read', () => {
    const blocked = {
      get cssRules(): CSSRuleList {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    } as unknown as CSSStyleSheet;

    expect(themesIn([blocked, sheet('[data-theme=pastel]')])).toEqual(['pastel']);
  });

  it('lists each theme once', () => {
    expect(themesIn([sheet('[data-theme=pastel]', '[data-theme=pastel] .btn')])).toEqual(['pastel']);
  });
});
