export type WaitStateKind =
  | 'loading'
  | 'downloading'
  | 'verifying'
  | 'processing'
  | 'empty'
  | 'thinking'
  | 'results'
  | 'error';

export type ComedyAudience = 'dashboard' | 'cli' | 'playground';

export interface WaitComedyRequest {
  state?: string;
  detail?: string;
  model?: string;
  audience?: string;
  duration_ms?: number;
  allow_model?: boolean;
}

export interface WaitComedyPack {
  primary: string;
  secondary: string;
  fact: string;
  mechanic: string;
  source: 'template' | 'ollama';
  model?: string;
  safe: boolean;
  generated_at: string;
}

type Candidate = {
  primary: string;
  secondary: string;
  mechanic: string;
};

type NormalizedRequest = {
  state: WaitStateKind;
  detail: string;
  model: string;
  audience: ComedyAudience;
  durationMs?: number;
  allowModel: boolean;
};

type FactEntry = {
  text: string;
  tags: WaitStateKind[];
};

const FACTS: FactEntry[] = [
  { text: 'Cephalopod fact: octopuses have three hearts.', tags: ['loading', 'thinking', 'processing', 'results'] },
  { text: 'Cephalopod fact: their blood is blue because it uses copper-rich hemocyanin.', tags: ['loading', 'thinking', 'processing'] },
  { text: 'Cephalopod fact: suckers can taste as well as grip.', tags: ['verifying', 'processing', 'results'] },
  { text: 'Cephalopod fact: many cephalopods use jet propulsion to move fast.', tags: ['downloading', 'processing', 'results'] },
  { text: 'Cephalopod fact: cuttlefish camouflage is controlled by chromatophores.', tags: ['loading', 'thinking', 'processing'] },
  { text: 'Myth note: Scylla was the original bad-options sea monster.', tags: ['loading', 'thinking', 'processing'] },
  { text: 'Myth note: hafgufa was so large sailors mistook it for an island.', tags: ['empty', 'loading', 'results'] },
  { text: 'Myth note: Akkorokamui was a giant red octopus spirit tied to healing.', tags: ['verifying', 'results', 'empty'] },
  { text: 'Myth note: the kraken was once described as a floating island of arms.', tags: ['downloading', 'processing', 'results'] },
  { text: 'Myth note: the lusca was said to lurk in blue holes in the Bahamas.', tags: ['empty', 'thinking', 'processing'] },
];

const FAMOUS_PHRASE_DENYLIST = [
  'why did the chicken cross the road',
  'take my wife',
  'i get no respect',
  'who is on first',
  'heres your sign',
  'one does not simply',
  'winter is coming',
  'ill be back',
  'thats what she said',
  'hello darkness my old friend',
];

const RECENT_SIGNATURE_LIMIT = 24;
const recentSignatures: string[] = [];
const stateCounters: Record<WaitStateKind, number> = {
  loading: 0,
  downloading: 0,
  verifying: 0,
  processing: 0,
  empty: 0,
  thinking: 0,
  results: 0,
  error: 0,
};
const factCounters: Record<WaitStateKind, number> = {
  loading: 0,
  downloading: 0,
  verifying: 0,
  processing: 0,
  empty: 0,
  thinking: 0,
  results: 0,
  error: 0,
};

export function normalizeWaitState(state?: string): WaitStateKind {
  const raw = (state || '').trim().toLowerCase();
  if (!raw) return 'loading';
  if (raw.includes('download') || raw.includes('pull')) return 'downloading';
  if (raw.includes('verif') || raw.includes('checksum') || raw.includes('integrity')) return 'verifying';
  if (raw.includes('result') || raw.includes('compile') || raw.includes('render')) return 'results';
  if (raw.includes('think')) return 'thinking';
  if (raw.includes('process') || raw.includes('generat') || raw.includes('crunch')) return 'processing';
  if (raw.includes('empty') || raw.includes('wait') || raw.includes('idle') || raw.includes('register')) return 'empty';
  if (raw.includes('error') || raw.includes('fail') || raw.includes('stalled')) return 'error';
  return 'loading';
}

function normalizeAudience(audience?: string): ComedyAudience {
  const raw = (audience || '').trim().toLowerCase();
  if (raw === 'cli' || raw === 'playground') return raw;
  return 'dashboard';
}

function cleanDetail(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function cleanModel(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function sanitizeLine(value: string, maxLen: number): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').slice(0, maxLen);
}

function buildPrimary(state: WaitStateKind, detail: string, model: string): string {
  switch (state) {
    case 'downloading':
      return sanitizeLine(detail ? `Downloading ${detail}...` : model ? `Downloading ${model}...` : 'Downloading model weights...', 88);
    case 'verifying':
      return sanitizeLine(detail ? `Verifying ${detail}...` : 'Verifying model integrity...', 88);
    case 'processing':
      return sanitizeLine(detail ? `Processing ${detail}...` : 'Processing request...', 88);
    case 'thinking':
      return sanitizeLine(detail ? `Thinking through ${detail}...` : 'Thinking through the request...', 88);
    case 'results':
      return sanitizeLine(detail ? `Preparing ${detail}...` : 'Preparing results...', 88);
    case 'empty':
      return sanitizeLine(detail ? `Waiting for ${detail}...` : 'Waiting for workers to check in...', 88);
    case 'error':
      return sanitizeLine(detail ? `${detail} stalled.` : 'Operation stalled.', 88);
    case 'loading':
    default:
      return sanitizeLine(detail ? `Loading ${detail}...` : 'Loading cluster data...', 88);
  }
}

function buildTemplateCandidates(req: NormalizedRequest): Candidate[] {
  const primary = buildPrimary(req.state, req.detail, req.model);
  const modelTail = req.model ? ` ${req.model}` : '';

  switch (req.state) {
    case 'downloading':
      return [
        { primary, secondary: `Hauling${modelTail} cargo up from the seafloor.`, mechanic: 'faux_epic' },
        { primary, secondary: 'Kraken-class freight is on the line.', mechanic: 'escalation' },
        { primary, secondary: 'Reeling it in one tentacle at a time.', mechanic: 'literalization' },
        { primary, secondary: 'Nothing dramatic. Just a suspiciously large package.', mechanic: 'deadpan' },
        { primary, secondary: 'Deep-sea logistics remain oddly professional.', mechanic: 'overqualified_diagnostic' },
      ];
    case 'verifying':
      return [
        { primary, secondary: 'Counting every sucker twice.', mechanic: 'deadpan' },
        { primary, secondary: 'Professional paranoia is part of the service.', mechanic: 'overqualified_diagnostic' },
        { primary, secondary: 'Checking the seals before release.', mechanic: 'literalization' },
        { primary, secondary: 'No counterfeit krakens allowed.', mechanic: 'tiny_reversal' },
        { primary, secondary: 'This is the part where we distrust everything politely.', mechanic: 'misdirection' },
      ];
    case 'processing':
      return [
        { primary, secondary: 'The ink is still drying.', mechanic: 'deadpan' },
        { primary, secondary: 'One mind. Eight parallel impulses.', mechanic: 'faux_epic' },
        { primary, secondary: 'Crunching with unsettling grace.', mechanic: 'escalation' },
        { primary, secondary: 'Disturbing the sand in a productive way.', mechanic: 'literalization' },
        { primary, secondary: 'Deep thought, shallow panic.', mechanic: 'tiny_reversal' },
      ];
    case 'thinking':
      return [
        { primary, secondary: 'Stretching all eight arms of the idea.', mechanic: 'literalization' },
        { primary, secondary: 'This reef has entered deliberation mode.', mechanic: 'deadpan' },
        { primary, secondary: 'Misdirection is loading. So is the answer.', mechanic: 'misdirection' },
        { primary, secondary: 'The suspiciously smart squid is considering it.', mechanic: 'faux_epic' },
        { primary, secondary: 'Current diagnostic: thoughtful splashing.', mechanic: 'overqualified_diagnostic' },
      ];
    case 'results':
      return [
        { primary, secondary: 'Results are surfacing now.', mechanic: 'faux_epic' },
        { primary, secondary: 'Polishing the final splash.', mechanic: 'literalization' },
        { primary, secondary: 'Bringing something slippery and useful onboard.', mechanic: 'misdirection' },
        { primary, secondary: 'The answer has breached the surface.', mechanic: 'escalation' },
        { primary, secondary: 'A tidy ending by abyssal standards.', mechanic: 'deadpan' },
      ];
    case 'empty':
      return [
        { primary, secondary: 'The reef is quiet. For now.', mechanic: 'deadpan' },
        { primary, secondary: 'No node has breached the surface yet.', mechanic: 'faux_epic' },
        { primary, secondary: 'Listening for movement below the waterline.', mechanic: 'overqualified_diagnostic' },
        { primary, secondary: 'TentaCLAW is pretending not to stare at the gateway.', mechanic: 'tiny_reversal' },
        { primary, secondary: 'Still water. Pending tentacles.', mechanic: 'misdirection' },
      ];
    case 'error':
      return [
        { primary, secondary: 'The sea got rough. Check logs and retry.', mechanic: 'direct_recovery' },
        { primary, secondary: 'This one needs a fix, not a punchline.', mechanic: 'direct_recovery' },
        { primary, secondary: 'Operation paused. Connectivity or node health is the next check.', mechanic: 'direct_recovery' },
      ];
    case 'loading':
    default:
      return [
        { primary, secondary: 'Stretching all eight arms.', mechanic: 'literalization' },
        { primary, secondary: 'Untangling tentacles and timestamps.', mechanic: 'misdirection' },
        { primary, secondary: 'A little ink, a lot of progress.', mechanic: 'deadpan' },
        { primary, secondary: 'Busy reef. Calm dashboard.', mechanic: 'tiny_reversal' },
        { primary, secondary: 'Just enough abyssal drama to feel premium.', mechanic: 'faux_epic' },
      ];
  }
}

function normalizeSignature(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSet(text: string): Set<string> {
  const tokens = normalizeSignature(text).split(' ').filter(Boolean);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function isOriginalEnough(text: string): boolean {
  const signature = normalizeSignature(text);
  if (!signature) return false;
  if (FAMOUS_PHRASE_DENYLIST.some(phrase => signature.includes(phrase))) return false;
  const current = tokenSet(signature);
  for (const recent of recentSignatures) {
    if (recent === signature) return false;
    if (jaccard(current, tokenSet(recent)) >= 0.82) return false;
  }
  return true;
}

function remember(text: string): void {
  const signature = normalizeSignature(text);
  if (!signature) return;
  recentSignatures.push(signature);
  if (recentSignatures.length > RECENT_SIGNATURE_LIMIT) {
    recentSignatures.splice(0, recentSignatures.length - RECENT_SIGNATURE_LIMIT);
  }
}

function pickFact(state: WaitStateKind): string {
  const options = FACTS.filter(f => f.tags.includes(state));
  if (options.length === 0) return 'Cephalopod fact: octopuses have three hearts.';
  const idx = factCounters[state] % options.length;
  factCounters[state] += 1;
  return options[idx].text;
}

export function buildTemplatePack(input: WaitComedyRequest): WaitComedyPack {
  const req: NormalizedRequest = {
    state: normalizeWaitState(input.state),
    detail: cleanDetail(input.detail),
    model: cleanModel(input.model),
    audience: normalizeAudience(input.audience),
    durationMs: typeof input.duration_ms === 'number' && Number.isFinite(input.duration_ms) ? input.duration_ms : undefined,
    allowModel: input.allow_model !== false,
  };

  const candidates = buildTemplateCandidates(req);
  const startIdx = stateCounters[req.state] % candidates.length;
  stateCounters[req.state] += 1;

  let chosen = candidates[startIdx];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[(startIdx + i) % candidates.length];
    if (isOriginalEnough(`${candidate.primary} ${candidate.secondary}`)) {
      chosen = candidate;
      break;
    }
  }

  const fact = req.state === 'error'
    ? 'Recovery note: use status, logs, and retry guidance before comedy.'
    : pickFact(req.state);

  const pack: WaitComedyPack = {
    primary: sanitizeLine(chosen.primary, 88),
    secondary: sanitizeLine(chosen.secondary, 96),
    fact: sanitizeLine(fact, 110),
    mechanic: chosen.mechanic,
    source: 'template',
    safe: true,
    generated_at: new Date().toISOString(),
  };

  remember(`${pack.primary} ${pack.secondary}`);
  return pack;
}

function isModelGenerationEnabled(req: NormalizedRequest): boolean {
  if (!req.allowModel) return false;
  if (process.env.TENTACLAW_COMEDY_DISABLE_LLM === '1') return false;
  return true;
}

function makeSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      primary: { type: 'string' },
      secondary: { type: 'string' },
      fact: { type: 'string' },
      mechanic: { type: 'string' },
    },
    required: ['primary', 'secondary', 'fact', 'mechanic'],
  };
}

function makePrompt(req: NormalizedRequest, fallback: WaitComedyPack): string {
  return [
    'You are the TentaCLAW Comedy Mechanics Engine.',
    'Write original wait-state microcopy for a GPU cluster dashboard.',
    'Do not quote, paraphrase, imitate, reference, or allude to any real comedian, special, movie line, or famous joke.',
    'Do not mention YouTube, stand-up, memes, or copyrighted bits.',
    'Primary must accurately name the real system state.',
    'Secondary may be funny, but keep it light, concise, and brand-safe.',
    'Prefer cephalopod science, sea-myth imagery, or deadpan diagnostics.',
    'Avoid death, drowning, madness, gore, or hostile sarcasm unless the state is error.',
    'Keep primary under 88 characters, secondary under 96, fact under 110.',
    'Use one mechanic label such as misdirection, deadpan, escalation, literalization, faux_epic, tiny_reversal, or overqualified_diagnostic.',
    `State: ${req.state}`,
    `Detail: ${req.detail || 'none'}`,
    `Model: ${req.model || 'none'}`,
    `Audience: ${req.audience}`,
    `Duration ms: ${req.durationMs ?? 'unknown'}`,
    `Fallback primary: ${fallback.primary}`,
    `Fallback secondary: ${fallback.secondary}`,
    `Allowed fact seed: ${fallback.fact}`,
    'Return JSON only matching the schema.',
  ].join('\n');
}

function validatePack(value: unknown, fallback: WaitComedyPack, model: string): WaitComedyPack | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const primary = sanitizeLine(String(record.primary || ''), 88);
  const secondary = sanitizeLine(String(record.secondary || ''), 96);
  const fact = sanitizeLine(String(record.fact || fallback.fact), 110);
  const mechanic = sanitizeLine(String(record.mechanic || 'deadpan'), 40);

  if (!primary || !secondary || !fact || !mechanic) return null;
  if (!isOriginalEnough(`${primary} ${secondary}`)) return null;
  if (primary.toLowerCase().includes('comedian') || secondary.toLowerCase().includes('comedian')) return null;

  const pack: WaitComedyPack = {
    primary,
    secondary,
    fact,
    mechanic,
    source: 'ollama',
    model,
    safe: true,
    generated_at: new Date().toISOString(),
  };

  remember(`${pack.primary} ${pack.secondary}`);
  return pack;
}

async function tryOllamaPack(req: NormalizedRequest, fallback: WaitComedyPack): Promise<WaitComedyPack | null> {
  if (!isModelGenerationEnabled(req)) return null;

  const model = process.env.TENTACLAW_COMEDY_MODEL || 'qwen3:8b';
  const baseUrl = (process.env.TENTACLAW_COMEDY_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');

  try {
    const response = await fetch(baseUrl + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: makePrompt(req, fallback),
        stream: false,
        format: makeSchema(),
        options: {
          temperature: 0.65,
          top_p: 0.9,
          repeat_penalty: 1.15,
          num_predict: 180,
        },
      }),
    });

    if (!response.ok) return null;
    const payload = await response.json() as { response?: string };
    if (!payload.response) return null;

    const parsed = JSON.parse(payload.response) as unknown;
    return validatePack(parsed, fallback, model);
  } catch {
    return null;
  }
}

export async function generateWaitComedy(input: WaitComedyRequest): Promise<WaitComedyPack> {
  const normalized: NormalizedRequest = {
    state: normalizeWaitState(input.state),
    detail: cleanDetail(input.detail),
    model: cleanModel(input.model),
    audience: normalizeAudience(input.audience),
    durationMs: typeof input.duration_ms === 'number' && Number.isFinite(input.duration_ms) ? input.duration_ms : undefined,
    allowModel: input.allow_model !== false,
  };

  const fallback = buildTemplatePack(input);
  if (normalized.state === 'error') return fallback;

  const llmPack = await tryOllamaPack(normalized, fallback);
  return llmPack || fallback;
}
