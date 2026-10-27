export const audioCriteria = [
  {
    id: 'rate',
    label: 'Rate of speech',
    detail: 'Notice rushing, slowdowns, and how comfortable your pace is to follow.',
  },
  {
    id: 'volume',
    label: 'Volume variation',
    detail: 'Listen for emphasis, a flat volume, or words that fade away.',
  },
  {
    id: 'pitch',
    label: 'Pitch and tone',
    detail: 'Notice warmth, expressiveness, and variation between questions and statements.',
  },
  {
    id: 'pauses',
    label: 'Places of pause',
    detail: 'Listen for intentional pauses, natural breaths, awkward gaps, and rushing.',
  },
  {
    id: 'endings',
    label: 'Sentence endings',
    detail: 'Notice upward inflection, clean conclusions, and trailing off.',
  },
  {
    id: 'clarity',
    label: 'Clarity and energy',
    detail: 'Assess intelligibility and consistent energy over the actual recording length.',
  },
  {
    id: 'fillers',
    label: 'Filler words',
    detail:
      'Count filler uses of um, uh, like, you know, so, basically, literally, or honestly. Distinguish meaningful words from fillers.',
  },
] as const

export const visualCriteria = [
  {
    id: 'posture',
    label: 'Posture',
    detail: 'Observe alignment, leaning, swaying, and shoulder movement.',
  },
  {
    id: 'gestures',
    label: 'Hand gestures',
    detail: 'Notice visible, purposeful gestures, timing, repetition, and fidgeting.',
  },
  {
    id: 'face',
    label: 'Facial expression',
    detail: 'Notice engagement, natural expression, and how it fits the message.',
  },
  {
    id: 'nerves',
    label: 'Signs of nervousness',
    detail:
      'Describe observable behaviors such as face touching or lip biting. Do not infer actual emotions or personality.',
  },
  {
    id: 'presence',
    label: 'Overall presence',
    detail: 'Watch on mute. Notice apparent composure, engagement, and approachability.',
  },
] as const

export const scale = [
  'Needs substantial improvement',
  'Inconsistent',
  'Adequate',
  'Strong',
  'Excellent',
]
export type AudioKey = (typeof audioCriteria)[number]['id']
export type VisualKey = (typeof visualCriteria)[number]['id']
export type Criterion = (typeof audioCriteria)[number] | (typeof visualCriteria)[number]
