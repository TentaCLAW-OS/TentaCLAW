/**
 * TentaCLAW ASCII Art Collection
 * 20 poses for different moods and situations.
 * TentaCLAW says: "I look good in every frame."
 */

export const TENTACLAW_POSES: Record<string, string[]> = {
    // Default — cool and confident
    default: [
        '        ,---.',
        '       / o o \\',
        '       | \\___/ |',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Happy — celebrating
    happy: [
        '        ,---.',
        '       / ^ ^ \\',
        '       | \\___/ |',
        '        \\_____/',
        '       \\|||||/',
        '        |||||',
        '       /|||||\\ ~*',
        '      * @@@@@ *',
    ],

    // Angry — something went wrong
    angry: [
        '        ,---.',
        '       / >.< \\',
        '       | /---\\ |',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       (!@@@@@!)',
        '        @@@@@',
    ],

    // Thinking — processing
    thinking: [
        '        ,---.',
        '       / o . \\  ?',
        '       | \\___/ |',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Sleeping — idle cluster
    sleeping: [
        '        ,---.',
        '       / - - \\  z z',
        '       | \\___/ |   z',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Flexing — good benchmarks
    flexing: [
        '     \\  ,---.  /',
        '      \\/ o o \\/',
        '       | \\___/ |',
        '        \\_____/',
        '    💪  |||||  💪',
        '        |||||',
        '       /|||||\\',
        '       @@@@@@@',
    ],

    // Sunglasses — vibe mode
    cool: [
        '        ,---.',
        '       / ■ ■ \\',
        '       | \\___/ |',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@ 😎',
    ],

    // Waving — greeting
    waving: [
        '        ,---.  /',
        '       / o o \\/',
        '       | \\___/ |',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Fixing — doctor mode
    fixing: [
        '        ,---.',
        '       / o o \\',
        '       | \\___/ |  🔧',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Deploying — sending models
    deploying: [
        '        ,---.',
        '       / o o \\',
        '       | \\___/ |',
        '        \\_____/ →→→',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Warning — alert
    warning: [
        '        ,---.',
        '       / ! ! \\',
        '       | /---\\ |',
        '        \\_____/',
        '     ⚠  |||||  ⚠',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Dancing — celebration
    dancing: [
        '     ♪  ,---.  ♪',
        '       / ^ ^ \\',
        '       | \\___/ |',
        '        \\_____/',
        '    \\   |||||   /',
        '     \\  |||||  /',
        '       /|||||\\',
        '      @@@@@@@@@',
    ],

    // Loading — processing request
    loading: [
        '        ,---.',
        '       / ◐ ◑ \\',
        '       | \\___/ |',
        '        \\_____/',
        '         |||||',
        '        /|||||\\',
        '       ( @@@@@ )',
        '        @@@@@',
    ],

    // Mob boss — serious business
    mobBoss: [
        '     🎩',
        '        ,---.',
        '       / ■ ■ \\',
        '       |  ─── |',
        '        \\_____/',
        '         ||||| 🤌',
        '        /|||||\\',
        '       ( @@@@@ )',
    ],

    // Small — for tight spaces
    mini: [
        '  /o o\\',
        '  \\___/',
        '  /|||\\',
    ],

    // Dead — critical failure
    dead: [
        '        ,---.',
        '       / x x \\',
        '       | \\___/ |',
        '        \\_____/',
        '         .....  ',
        '        /.....\\',
        '       ( ..... )',
        '        .....',
    ],
};

/**
 * Get ASCII art for current mood
 */
export function getAsciiArt(pose: keyof typeof TENTACLAW_POSES = 'default'): string[] {
    return TENTACLAW_POSES[pose] || TENTACLAW_POSES.default;
}

/**
 * Get a random pose
 */
export function getRandomPose(): string[] {
    const poses = Object.keys(TENTACLAW_POSES);
    const key = poses[Math.floor(Math.random() * poses.length)];
    return TENTACLAW_POSES[key];
}
