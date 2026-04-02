/**
 * TentaCLAW ASCII Art Collection
 * 20 poses for different moods and situations.
 * TentaCLAW says: "I look good in every frame."
 */
export declare const TENTACLAW_POSES: Record<string, string[]>;
/**
 * Get ASCII art for current mood
 */
export declare function getAsciiArt(pose?: keyof typeof TENTACLAW_POSES): string[];
/**
 * Get a random pose
 */
export declare function getRandomPose(): string[];
