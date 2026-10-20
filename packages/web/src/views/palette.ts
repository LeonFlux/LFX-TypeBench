export const MODEL_COLORS = ['primary', 'secondary', 'accent', 'info', 'success', 'warning'] as const;

export type ModelColor = (typeof MODEL_COLORS)[number];

export type Level = 'direct' | 'estimated' | 'closed';

const PAINT: Record<ModelColor, string> = {
  primary: 'mc-primary',
  secondary: 'mc-secondary',
  accent: 'mc-accent',
  info: 'mc-info',
  success: 'mc-success',
  warning: 'mc-warning',
};

const STATUS: Record<ModelColor, string> = {
  primary: 'status-primary',
  secondary: 'status-secondary',
  accent: 'status-accent',
  info: 'status-info',
  success: 'status-success',
  warning: 'status-warning',
};

const PROGRESS: Record<ModelColor, string> = {
  primary: 'progress-primary',
  secondary: 'progress-secondary',
  accent: 'progress-accent',
  info: 'progress-info',
  success: 'progress-success',
  warning: 'progress-warning',
};

const LEVEL_STATUS: Record<Level, string> = {
  direct: 'status-success',
  estimated: 'status-warning',
  closed: 'status-neutral',
};

function swap(element: Element, options: Record<string, string>, chosen: string) {
  element.classList.remove(...Object.values(options));
  element.classList.add(chosen);
}

export function colorAt(index: number): ModelColor {
  return MODEL_COLORS[Math.max(0, index) % MODEL_COLORS.length] ?? 'primary';
}

export function paint(element: HTMLElement, color: ModelColor) {
  swap(element, PAINT, PAINT[color]);
  for (const dot of element.querySelectorAll('[data-model-color]')) swap(dot, STATUS, STATUS[color]);
  for (const bar of element.querySelectorAll('.bar-row .progress')) swap(bar, PROGRESS, PROGRESS[color]);
}

export function availability(available: boolean): Level {
  return available ? 'direct' : 'closed';
}

export function setLevel(element: HTMLElement, level: Level) {
  element.dataset.level = level;
  const dot = element.querySelector('.status');
  if (dot) swap(dot, LEVEL_STATUS, LEVEL_STATUS[level]);
  element.classList.toggle('opacity-60', level === 'closed');
}
