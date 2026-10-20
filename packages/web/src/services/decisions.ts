import { type Draft, newQuestion } from './draft.ts';

export type Workspace = { drafts: Draft[]; activeKey: string };

export type DecisionSummary = { name: string; questions: number; version: number };

const NEW_NAME = 'Untitled decision';
const NEW_ID_PREFIX = 'decision-';

export function newKey(): string {
  return crypto.randomUUID();
}

export function workspaceOf(drafts: Draft[], activeKey?: string): Workspace {
  const active = drafts.find((draft) => draft.key === activeKey) ?? drafts[0];
  return { drafts, activeKey: active?.key ?? '' };
}

export function activeDraft(workspace: Workspace): Draft | undefined {
  return workspace.drafts.find((draft) => draft.key === workspace.activeKey);
}

export function summaryOf(draft: Draft): DecisionSummary {
  return { name: draft.name, questions: draft.questions.length, version: draft.version };
}

export function selectDecision(workspace: Workspace, key: string): Workspace {
  return workspace.drafts.some((draft) => draft.key === key) ? { ...workspace, activeKey: key } : workspace;
}

function blankDraft(takenIds: string[]): Draft {
  let n = takenIds.length + 1;
  while (takenIds.includes(`${NEW_ID_PREFIX}${n}`)) n++;
  return {
    key: newKey(),
    name: NEW_NAME,
    id: `${NEW_ID_PREFIX}${n}`,
    version: 1,
    input: { format: 'text', value: '' },
    questions: [newQuestion('yes-no', [])],
  };
}

export function addDecision(workspace: Workspace): Workspace {
  const draft = blankDraft(workspace.drafts.map((candidate) => candidate.id));
  return { drafts: [...workspace.drafts, draft], activeKey: draft.key };
}

export function removeDecision(workspace: Workspace, key: string): Workspace {
  const index = workspace.drafts.findIndex((draft) => draft.key === key);
  if (index < 0) return workspace;
  if (workspace.drafts.length === 1) {
    const blank = blankDraft([]);
    return { drafts: [blank], activeKey: blank.key };
  }

  const drafts = workspace.drafts.filter((draft) => draft.key !== key);
  if (workspace.activeKey !== key) return { drafts, activeKey: workspace.activeKey };
  const next = drafts[Math.min(index, drafts.length - 1)];
  return { drafts, activeKey: next?.key ?? '' };
}

export function missingDefaults(workspace: Workspace, defaults: Draft[]): Draft[] {
  const listed = workspace.drafts.map((draft) => draft.id);
  return defaults.filter((draft) => !listed.includes(draft.id));
}

export function restoreDefaults(workspace: Workspace, defaults: Draft[]): Workspace {
  return { ...workspace, drafts: [...workspace.drafts, ...missingDefaults(workspace, defaults)] };
}
