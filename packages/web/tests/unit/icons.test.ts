import { describe, expect, it } from 'vitest';
import { iconNames, spriteOf, symbolOf, useIcons } from '../../icons.ts';

const HEROICON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon">\n  <path d="M6 18 18 6"/>\n</svg>\n';

describe('heroicons sprite', () => {
  it('lists each icon an html page uses once', () => {
    const html =
      '<svg width="12" data-icon="24/outline/x-mark"></svg><svg data-icon="16/solid/play"></svg><svg data-icon="24/outline/x-mark"></svg>';

    expect(iconNames(html)).toEqual(['16/solid/play', '24/outline/x-mark']);
  });

  it('turns a Heroicons file into a symbol that keeps its drawing attributes', () => {
    expect(symbolOf('24/outline/x-mark', HEROICON)).toBe(
      '<symbol id="24-outline-x-mark" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">\n  <path d="M6 18 18 6"/>\n</symbol>',
    );
    expect(spriteOf(['<symbol id="a"></symbol>'])).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="a"></symbol></svg>',
    );
  });

  it('points each icon placeholder at the sprite asset, keeping its other attributes', () => {
    const html = '<svg width="12" height="12" aria-hidden="true" data-icon="16/solid/x-mark"></svg>';

    expect(useIcons(html, '/assets/icons-abc.svg')).toBe(
      '<svg width="12" height="12" aria-hidden="true"><use href="/assets/icons-abc.svg#16-solid-x-mark"/></svg>',
    );
  });

  it('refuses an icon name outside the Heroicons sizes and styles', () => {
    expect(() => iconNames('<svg data-icon="../../secret"></svg>')).toThrow('Unknown icon name');
  });
});
