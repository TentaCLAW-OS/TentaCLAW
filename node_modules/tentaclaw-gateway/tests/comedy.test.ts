import { describe, expect, it } from 'vitest';
import { buildTemplatePack, generateWaitComedy, isOriginalEnough, normalizeWaitState } from '../src/comedy';

describe('comedy engine', () => {
  it('normalizes wait states', () => {
    expect(normalizeWaitState('download')).toBe('downloading');
    expect(normalizeWaitState('verifying checksum')).toBe('verifying');
    expect(normalizeWaitState('waiting for nodes')).toBe('empty');
    expect(normalizeWaitState('processing results')).toBe('results');
    expect(normalizeWaitState('')).toBe('loading');
  });

  it('builds a template pack with status-first primary text', () => {
    const pack = buildTemplatePack({ state: 'downloading', detail: 'model weights', allow_model: false });
    expect(pack.primary.toLowerCase()).toContain('downloading');
    expect(pack.secondary.length).toBeGreaterThan(0);
    expect(pack.source).toBe('template');
    expect(pack.safe).toBe(true);
  });

  it('blocks famous phrases from originality checks', () => {
    expect(isOriginalEnough('Why did the chicken cross the road?')).toBe(false);
  });

  it('generates without Ollama when model use is disabled', async () => {
    const pack = await generateWaitComedy({
      state: 'processing',
      detail: 'benchmark results',
      allow_model: false,
    });

    expect(pack.primary.toLowerCase()).toContain('processing');
    expect(pack.secondary.length).toBeGreaterThan(0);
    expect(pack.fact.length).toBeGreaterThan(0);
    expect(pack.source).toBe('template');
  });

  it('uses direct recovery copy for error states', async () => {
    const pack = await generateWaitComedy({
      state: 'error',
      detail: 'Model pull',
      allow_model: false,
    });

    expect(pack.primary.toLowerCase()).toContain('stalled');
    expect(pack.secondary.toLowerCase()).toContain('retry');
    expect(pack.mechanic).toBe('direct_recovery');
  });
});
