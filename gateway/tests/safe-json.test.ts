import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '../src/db/safe-json';

describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
        expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    });
    it('returns fallback on invalid JSON', () => {
        expect(safeJsonParse('not json', { fallback: true })).toEqual({ fallback: true });
    });
    it('returns fallback on empty string', () => {
        expect(safeJsonParse('', null)).toBeNull();
    });
    it('returns fallback on undefined input', () => {
        expect(safeJsonParse(undefined as any, [])).toEqual([]);
    });
    it('parses valid array JSON', () => {
        expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
    });
    it('returns fallback on truncated JSON', () => {
        expect(safeJsonParse('{"a":', {})).toEqual({});
    });
});
