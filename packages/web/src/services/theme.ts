const THEME_SELECTOR = /\[data-theme="?([\w-]+)"?\]/g;

function rulesOf(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return [...sheet.cssRules];
  } catch {
    return [];
  }
}

function selectorsOf(rule: CSSRule): string[] {
  const nested = 'cssRules' in rule ? [...(rule as CSSGroupingRule).cssRules].flatMap(selectorsOf) : [];
  const own = 'selectorText' in rule ? [String((rule as CSSStyleRule).selectorText)] : [];
  return [...own, ...nested];
}

export function themesIn(sheets: Iterable<CSSStyleSheet>): string[] {
  const names = [...sheets]
    .flatMap(rulesOf)
    .flatMap(selectorsOf)
    .flatMap((selector) => [...selector.matchAll(THEME_SELECTOR)].map((match) => match[1] ?? ''));
  return [...new Set(names.filter(Boolean))];
}

export function chooseTheme(themes: string[], current: string | null): string | null {
  if (current && themes.includes(current)) return current;
  return themes[0] ?? null;
}

export function applyTheme(document: Document) {
  const root = document.documentElement;
  const theme = chooseTheme(themesIn(document.styleSheets), root.dataset.theme ?? null);
  if (theme) root.dataset.theme = theme;
}
