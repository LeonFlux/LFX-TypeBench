export const CAPABILITIES = ['probabilities', 'reasoning', 'attribution', 'confidence'] as const;

export type Capability = (typeof CAPABILITIES)[number];
