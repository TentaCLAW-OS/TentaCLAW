/* ═══════════════════════════════════════════════════════════════════════════
 * TentaCLAW Personality Engine
 * Contextual messages based on cluster mood — the soul of the dashboard.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Mood = 'healthy' | 'warning' | 'error' | 'idle' | 'busy' | 'offline';

const messages: Record<Mood, string[]> = {
  healthy: [
    "chill, everything's smooth",
    'running like a dream',
    'eight arms, zero problems',
    "you didn't even notice huh... that's the point",
    'all tentacles accounted for',
    'smooth sailing in the deep',
    'I got this. go grab coffee',
  ],
  warning: [
    "something's cooking... watching it",
    'not ideal but not a crisis',
    'keeping an eye on that one',
    "one arm's a bit warm, the other seven are fine",
    "could be worse. I've seen worse",
  ],
  error: [
    'okay we got a problem',
    'lost contact with a node... not great',
    "fixing it. don't touch anything",
    'this is fine. this is totally fine',
    'brb, regrowing an arm',
  ],
  idle: [
    'pretty quiet in here...',
    'all dressed up, nowhere to infer',
    'GPUs are just vibing right now',
    'deploy a model maybe? just a thought',
  ],
  busy: [
    'all eight arms are busy',
    'tokens go brrr',
    'working hard or hardly working? ...definitely working hard',
    'inference machine go brrr',
  ],
  offline: [
    '...hello? anyone out there?',
    'the ocean is empty today',
    'no nodes, no problems? nah, this is a problem',
  ],
};

/**
 * Derive the cluster mood from node counts and alert state.
 */
export function getMood(
  onlineNodes: number,
  totalNodes: number,
  hasWarning: boolean,
  hasError: boolean,
): Mood {
  if (totalNodes === 0) return 'offline';
  if (onlineNodes === 0) return 'offline';
  if (hasError) return 'error';
  if (hasWarning) return 'warning';

  const onlineRatio = onlineNodes / totalNodes;

  // If most nodes are online and no alerts — check if busy or healthy
  if (onlineRatio >= 0.9) {
    // We can't easily know utilisation here, so healthy is default.
    // The caller can override to 'busy' if utilisation is high.
    return 'healthy';
  }

  // Some nodes are offline but no errors/warnings
  if (onlineRatio > 0) return 'warning';

  return 'idle';
}

/**
 * Pick a random personality message for a given mood.
 */
export function getPersonalityMessage(mood: Mood): string {
  const pool = messages[mood];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Time-based greeting from TentaCLAW.
 */
export function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) return 'good morning';
  if (hour >= 12 && hour < 17) return 'good afternoon';
  if (hour >= 17 && hour < 21) return 'good evening';
  if (hour >= 21 || hour < 2) return 'burning the midnight oil?';
  return "you're up late... respect";
}

/**
 * Contextual empty-state tips for each tab area.
 */
export const emptyStateTips: Record<string, string> = {
  models: "drag a model onto a node in the tree to deploy it",
  terminal: "pick a node from the tree first, then I'll open a shell",
  alerts: "no alerts means I'm doing my job",
  gpus: "connect an agent with GPU hardware and I'll take it from here",
  inference: "no inference requests yet... deploy a model and send some prompts",
};
