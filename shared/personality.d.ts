/**
 * TentaCLAW Personality Engine
 * "I'm gonna make you an inference you can't refuse."
 *
 * Shared personality module for TentaCLAW CLI, Gateway, and Dashboard.
 * All 225 quotes from the TentaCLAW Mob Quotes Archive, organized by category,
 * with mood-aware selection and context-driven responses.
 */
export type MoodState = 'confident' | 'pleased' | 'concerned' | 'angry' | 'celebrating' | 'menacing' | 'philosophical';
export interface PersonalityContext {
    health_score?: number;
    node_count?: number;
    online_count?: number;
    gpu_temp_max?: number;
    error_count?: number;
    uptime_hours?: number;
    time_of_day?: number;
    milestone?: string;
}
/**
 * Determine TentaCLAW mood from cluster context.
 *
 * Priority order:
 *   1. milestone achieved → celebrating
 *   2. node down (online < total) → menacing
 *   3. late night (11pm-5am) → philosophical
 *   4. health < 50 → angry
 *   5. health 50-79 → concerned
 *   6. health >= 80, no errors → confident or pleased
 */
export declare function getMood(ctx: PersonalityContext): MoodState;
/**
 * Get a random quote appropriate for the current mood.
 */
export declare function getQuote(mood: MoodState): string;
/**
 * Get a context-aware response for a specific event.
 *
 * Supported events:
 *   - 'node_online', 'node_offline', 'deploy', 'benchmark', 'scale',
 *     'error', 'thermal', 'startup', 'shutdown', 'health_check'
 */
export declare function getEventResponse(event: string, ctx?: PersonalityContext): string;
/**
 * Get a greeting based on time of day.
 */
export declare function getGreeting(): string;
/**
 * Get a farewell.
 */
export declare function getFarewell(): string;
/**
 * Get a random mob movie quote (adapted for GPUs).
 */
export declare function getMovieQuote(): string;
/**
 * Get a loading/waiting message.
 */
export declare function getLoadingMessage(): string;
/**
 * Get an error message with personality.
 * The actual error string is embedded in the response.
 */
export declare function getErrorMessage(error: string): string;
/**
 * Get a celebration message for milestones.
 */
export declare function getCelebration(milestone: string): string;
/**
 * Get a threat/warning for problems.
 */
export declare function getWarning(issue: string): string;
/**
 * Get a random wise guy one-liner.
 */
export declare function getWiseGuy(): string;
