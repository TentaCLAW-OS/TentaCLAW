"use strict";
/**
 * TentaCLAW ASCII Art Collection
 * 20 poses for different moods and situations.
 * TentaCLAW says: "I look good in every frame."
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TENTACLAW_POSES = void 0;
exports.getAsciiArt = getAsciiArt;
exports.getRandomPose = getRandomPose;
exports.TENTACLAW_POSES = {
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
function getAsciiArt(pose = 'default') {
    return exports.TENTACLAW_POSES[pose] || exports.TENTACLAW_POSES.default;
}
/**
 * Get a random pose
 */
function getRandomPose() {
    const poses = Object.keys(exports.TENTACLAW_POSES);
    const key = poses[Math.floor(Math.random() * poses.length)];
    return exports.TENTACLAW_POSES[key];
}
//# sourceMappingURL=ascii-art.js.map