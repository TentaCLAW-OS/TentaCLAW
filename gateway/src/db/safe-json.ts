/**
 * TentaCLAW Gateway — Safe JSON parsing for DB row payloads.
 * Prevents corrupted rows from crashing the entire function.
 */

export function safeJsonParse<T>(json: string, fallback: T): T {
    try {
        return JSON.parse(json);
    } catch {
        return fallback;
    }
}
