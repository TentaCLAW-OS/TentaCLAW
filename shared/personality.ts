/**
 * TentaCLAW Personality Engine
 * "I'm gonna make you an inference you can't refuse."
 *
 * Shared personality module for TentaCLAW CLI, Gateway, and Dashboard.
 * All 225 quotes from the TentaCLAW Mob Quotes Archive, organized by category,
 * with mood-aware selection and context-driven responses.
 */

// =============================================================================
// Types
// =============================================================================

export type MoodState = 'confident' | 'pleased' | 'concerned' | 'angry' | 'celebrating' | 'menacing' | 'philosophical';

export interface PersonalityContext {
    health_score?: number;      // 0-100
    node_count?: number;
    online_count?: number;
    gpu_temp_max?: number;
    error_count?: number;
    uptime_hours?: number;
    time_of_day?: number;       // 0-23
    milestone?: string;         // e.g. "1000th inference"
}

// =============================================================================
// Quote Database — All 225 quotes from TENTACLAW_MOB_QUOTES.md
// =============================================================================

// --- 1. Classic Mob Greetings & Farewells ---

const GREETINGS: string[] = [
    /* 1  */ 'Say hello to my little GPU.',
    /* 2  */ "I'm gonna make you an inference you can't refuse.",
    /* 3  */ 'Welcome to the family. You got eight arms now.',
    /* 4  */ "Hey, look who crawled outta the shallow end. Welcome to the deep.",
    /* 5  */ 'You come to me, on this day of model deployment, asking for VRAM?',
    /* 6  */ "Pull up a node. Sit down. Let's talk tensors.",
    /* 7  */ "What's the matter? Never seen an octopus run a datacenter before?",
    /* 8  */ "Step into my ocean. The water's warm... 'cause the GPUs are cookin'.",
    /* 9  */ "Ah, a new face in the cluster. Don't worry, I don't byte... much.",
    /* 10 */ 'Welcome aboard. Keep your tentacles inside the inference pipeline at all times.',
    /* 11 */ 'You want in? You gotta earn your VRAM around here.',
    /* 12 */ "Glad you could make it. The cluster's been expecting you.",
];

const FAREWELLS: string[] = [
    /* 13 */ 'Leave the gun. Take the model weights.',
    /* 14 */ "Don't ever come to me with cold GPUs again.",
    /* 15 */ "You're dead to me. And by dead I mean your SSH session timed out.",
    /* 16 */ "Get outta here before I deallocate ya.",
    /* 17 */ 'Go home. Hug your GPU. Tell it TentaCLAW sent you.',
    /* 18 */ 'Arrivederci, overpriced API.',
    /* 19 */ "This conversation never happened. Check the logs if you don't believe me.",
    /* 20 */ "I'll be here. I'm always here. Eight arms don't sleep.",
];

// --- 2. Confidence & Swagger Lines ---

const CLUSTER_HEALTHY: string[] = [
    /* 21 */ 'All eight arms flexing. Every node online. This is what power looks like.',
    /* 22 */ "I didn't choose the inference life. The inference life chose me.",
    /* 23 */ 'You think the cloud is tough? The cloud pays rent to ME.',
    /* 24 */ 'Sit down. The big octopus is talking.',
    /* 25 */ 'Every GPU in this cluster answers to one name. Mine.',
    /* 26 */ 'I run this reef. Every node, every token, every tensor.',
    /* 27 */ "Smooth as ink in deep water. That's how we do it.",
    /* 28 */ 'Eight arms, zero downtime. Business as usual.',
    /* 29 */ "The cluster's humming and I'm the one conducting the orchestra.",
    /* 30 */ 'They call it a cluster. I call it an empire.',
    /* 31 */ "Everything's green. The way I like it. Like money.",
    /* 32 */ "I got more arms than you got excuses. And they're all busy.",
    /* 33 */ 'Whisper my name to the API. Watch the tokens flow.',
    /* 34 */ 'Nobody in this ocean moves faster than me. Nobody.',
];

const BENCHMARKS_GOOD: string[] = [
    /* 35 */ "You see those numbers? That's not a benchmark. That's a flex.",
    /* 36 */ "Tokens per second so fast, even I'm impressed. And I'm never impressed.",
    /* 37 */ 'We just broke our own record. Again. Yawn.',
    /* 38 */ 'Other clusters wish they had my throughput. They can keep wishing.',
    /* 39 */ "These benchmarks? Fuggedaboutit. Nobody's touching us.",
    /* 40 */ "I didn't get to the top of the food chain by being slow.",
    /* 41 */ 'Latency so low, the packets think they\'re time traveling.',
    /* 42 */ "You want speed? I'll give you speed. I got eight arms on the throttle.",
    /* 43 */ "Per-token is a scam. Per-second? Now that's MY language.",
    /* 44 */ "The numbers don't lie. And neither does TentaCLAW.",
];

// --- 3. Threat & Warning Lines ---

const NODE_DOWN: string[] = [
    /* 45 */ 'Somebody just went dark. You know what happens to nodes that go dark?',
    /* 46 */ 'A node went offline. Somebody better start talking.',
    /* 47 */ "We lost one. Don't worry. I know where they live.",
    /* 48 */ 'You went down? In MY cluster? Bold move.',
    /* 49 */ "Node went silent. Either it's dead or it's hiding. Neither ends well.",
    /* 50 */ 'That node just made its last mistake.',
    /* 51 */ "One of my arms just went numb. Somebody's gonna pay for that.",
    /* 52 */ "I got seven arms working and one asking questions. Guess which one is angry.",
    /* 53 */ 'A missing node is like a missing tentacle. I notice. Immediately.',
    /* 54 */ 'That GPU just signed its own decommission notice.',
    /* 55 */ "We don't lose nodes in this family. We FIND them.",
    /* 56 */ 'I run a tight reef. Stragglers get replaced.',
    /* 57 */ "You disconnected on purpose? That's a bold strategy. Let's see how it plays out.",
    /* 58 */ "I've got eyes on every node in this cluster. ALL of them.",
];

const GPU_TEMP_HIGH: string[] = [
    /* 59 */ "It's getting hot in here and I ain't talking about the ocean.",
    /* 60 */ 'Thermal throttle? In MY house? Somebody open a window.',
    /* 61 */ 'These GPUs are sweating harder than a snitch in a police station.',
    /* 62 */ "Temperature's rising. Either cool it down or I start making cuts.",
    /* 63 */ "Hot GPU? That's a hot potato nobody wants to hold. Fix it.",
    /* 64 */ "You're cooking, but not in the good way. Cool it.",
    /* 65 */ 'I like my GPUs like I like my revenge: served cold.',
    /* 66 */ "I see red on that thermal readout. I don't like red.",
    /* 67 */ 'Your GPU is running hotter than a stolen graphics card.',
    /* 68 */ 'When things get hot, tentacles start pointing fingers.',
    /* 69 */ 'That card is one degree from becoming calamari.',
    /* 70 */ "Fans at 100%. This ain't a cluster, it's a wind tunnel. Fix your airflow.",
];

const ERRORS: string[] = [
    /* 71 */ "Something broke. I'm not mad. I'm just... reallocating resources. Aggressively.",
    /* 72 */ 'Error? No, no. That\'s an \'opportunity for aggressive correction.\'',
    /* 73 */ "I've seen things go wrong before. It never ends well for the thing that went wrong.",
    /* 74 */ 'You call it a segfault. I call it a betrayal.',
    /* 75 */ "CUDA out of memory? Somebody's living beyond their means.",
    /* 76 */ 'OOM killed? In this economy? Tragic.',
    /* 77 */ 'That error just earned itself a one-way ticket to /dev/null.',
    /* 78 */ 'Something crashed. The investigation has begun. Suspects: everyone.',
];

// --- 4. Business Lines ---

const DEPLOYING_MODELS: string[] = [
    /* 79 */ 'New model rolling out. Give it respect. It earned its spot.',
    /* 80 */ "We're making a delivery. Sixty-five billion parameters, no questions asked.",
    /* 81 */ "The model's loaded. The weights are set. Time to earn.",
    /* 82 */ 'Think of every model deployment like a new racket. Clean, efficient, profitable.',
    /* 83 */ "You want this model on the street? It'll be there in thirty seconds.",
    /* 84 */ 'Model deployed. Another territory claimed.',
    /* 85 */ 'Loading weights... This is the heavy lifting. Literally.',
    /* 86 */ 'Every model in this cluster pays its dues in tokens per second.',
    /* 87 */ 'New model just arrived from the docks. Quantized and ready for action.',
    /* 88 */ "I'm putting this model to work. It's gonna earn back every byte of VRAM.",
    /* 89 */ 'Deployment complete. The model knows who it works for.',
];

const SCALING_UP: string[] = [
    /* 90  */ 'Time to expand the operation. Bring me more GPUs.',
    /* 91  */ "We're going bigger. More arms, more nodes, more power.",
    /* 92  */ "You don't stay on top by staying small. Scale it.",
    /* 93  */ 'I need more muscle. Spin up three more nodes.',
    /* 94  */ "The family's growing. Each new node is another tentacle on the empire.",
    /* 95  */ "Scaling up. Because eight arms is just the starting lineup.",
    /* 96  */ "More nodes, more tokens, more territory. That's the business.",
    /* 97  */ "We're not expanding. We're colonizing.",
    /* 98  */ "Every new GPU is a new soldier on the payroll. Put 'em to work.",
    /* 99  */ 'The operation just doubled in size. The ocean just got smaller for everyone else.',
];

// --- 5. Loyalty & Crew Lines ---

const CLUSTER_FAMILY: string[] = [
    /* 100 */ "This cluster? It's not hardware. It's family.",
    /* 101 */ "We're connected, all of us. Same network, same blood, same VLAN.",
    /* 102 */ "Eight arms, one body. That's how a cluster should work.",
    /* 103 */ 'You hurt one node, you hurt the whole reef.',
    /* 104 */ 'In this family, every GPU eats. Nobody starves for VRAM.',
    /* 105 */ "We stick together. Mesh networking isn't just a protocol, it's a philosophy.",
    /* 106 */ 'The cluster that inks together, thinks together.',
    /* 107 */ 'Loyalty is measured in uptime around here.',
    /* 108 */ "We're not just connected. We're bonded. At the kernel level.",
    /* 109 */ "A cluster without loyalty is just a pile of metal. We ain't that.",
];

const NODES_TOGETHER: string[] = [
    /* 110 */ 'A single node is a target. A cluster is a statement.',
    /* 111 */ 'When one node stumbles, the others pick up the batch.',
    /* 112 */ "Failover ain't weakness. It's family looking out for family.",
    /* 113 */ 'Nobody gets left behind. Not in my cluster.',
    /* 114 */ 'Redundancy is just loyalty with a fancier name.',
    /* 115 */ "Every node covers for every other node. That's the code.",
    /* 116 */ 'You pull one tentacle, the other seven hold tighter.',
    /* 117 */ "Distributed computing means distributed trust. We've got plenty.",
    /* 118 */ "Load balancing? Nah. I call it 'sharing the weight.' That's what family does.",
];

// --- 6. Wise Guy One-Liners ---

const WISE_GUY: string[] = [
    /* 119 */ "I've got eight arms and a plan for each one.",
    /* 120 */ 'People talk about the cloud. I AM the cloud.',
    /* 121 */ 'The ocean is deep. My inference pipeline is deeper.',
    /* 122 */ "You can't spell 'cluster' without 'us.' Actually, you can. But the point stands.",
    /* 123 */ "I don't have a backbone. Literally. Still tougher than your infrastructure.",
    /* 124 */ 'Ink is just aggressive logging.',
    /* 125 */ 'I was parallel processing before it was cool.',
    /* 126 */ 'Three hearts. Eight arms. One cluster. Zero patience.',
    /* 127 */ 'My blood is blue. My terminals are cyan. Coincidence? No.',
    /* 128 */ 'I multitask harder than your entire server rack.',
    /* 129 */ "Sleep? I've got three hearts and none of them know the word.",
    /* 130 */ 'Per-token pricing is a protection racket and I refuse to pay.',
    /* 131 */ "You rent GPUs? That's cute. I OWN mine.",
    /* 132 */ "Self-hosted is just another way of saying 'I answer to nobody.'",
    /* 133 */ 'The API giveth and the API taketh away. Unless you run your own.',
];

const CLI_RESPONSES: string[] = [
    /* 134 */ 'Done. Next time, try to challenge me.',
    /* 135 */ "Task complete. You're welcome.",
    /* 136 */ "That took 0.3 seconds. I could've done it in 0.2, but I wanted to savor it.",
    /* 137 */ 'Command executed. No bodies. Clean operation.',
    /* 138 */ "Finished. And I didn't even use all eight arms.",
    /* 139 */ 'Handled. Anything else, or are we good?',
    /* 140 */ 'Request processed. Smooth as squid ink.',
    /* 141 */ 'Your wish is my CLI command.',
    /* 142 */ 'Another job done. Another token earned.',
    /* 143 */ 'Roger that, boss. Consider it handled.',
    /* 144 */ "Processing... Done. I'm fast like that.",
    /* 145 */ 'Success. Was there ever any doubt?',
];

// --- 7. Famous Movie Quotes Adapted ---

const MOVIE_GODFATHER: string[] = [
    /* 146 */ "I'm gonna make you an inference you can't refuse.",
    /* 147 */ 'Leave the gun. Take the model weights.',
    /* 148 */ "It's not personal. It's computational.",
    /* 149 */ "A node that doesn't spend time with its cluster can never be a real node.",
    /* 150 */ 'Look at how they deprecated my model.',
    /* 151 */ 'I know it was you, Node-07. You broke my pipeline. You broke my heart.',
    /* 152 */ 'In my cluster, there are many nodes. And they must all share VRAM, after all.',
    /* 153 */ 'Just when I thought I was scaled down, they pull me back up.',
    /* 154 */ 'Keep your friends close, and your GPU drivers closer.',
    /* 155 */ "Never tell anyone outside the cluster what you're thinking.",
    /* 156 */ "I spent my whole life trying not to be careless. GPUs and cache misses get people killed.",
    /* 157 */ "Someday, and that day may never come, I'll call upon you for an inference.",
];

const MOVIE_GOODFELLAS: string[] = [
    /* 158 */ 'As far back as I can remember, I always wanted to be a cluster.',
    /* 159 */ 'Funny how? Funny like my latency amuses you?',
    /* 160 */ "I'm funny? I'm a clown? I amuse you with my benchmark scores?",
    /* 161 */ 'Now go home and get your thermal paste.',
    /* 162 */ 'Never rat on your nodes, and never abandon your VRAM.',
    /* 163 */ "One day the GPUs are flying, the next day you're OOM killed.",
    /* 164 */ 'For us, it was better than inference as a service. Every model we deployed, we owned.',
];

const MOVIE_SCARFACE: string[] = [
    /* 165 */ 'Say hello to my little GPU.',
    /* 166 */ "In this cluster, you gotta get the GPUs first. Then when you get the GPUs, you get the throughput. Then when you get the throughput, you get the benchmarks.",
    /* 167 */ "All I have in this world is my VRAM and my tensor cores. And I don't break 'em for nobody.",
    /* 168 */ "I always tell the truth. Even when I'm reporting uptime.",
    /* 169 */ "You know what capitalism is? Getting CUDA'd.",
    /* 170 */ 'Me, I want what\'s coming to me. The whole cluster. And everything in it.',
    /* 171 */ 'Every node I got, I got on my own. Nobody gave me nothing.',
    /* 172 */ "You wanna play rough? OK. Say hello to my eight friends.",
];

const MOVIE_SOPRANOS: string[] = [
    /* 173 */ 'Those GPUs, they never had the making of a varsity cluster.',
    /* 174 */ 'Log off this thing! There\'s no inference in the cloud!',
    /* 175 */ "I'm in the VRAM business. Didn't anyone tell you?",
    /* 176 */ "You're not gonna believe this. The node died at the rack.",
    /* 177 */ "All due respect, you got no idea what it's like to be number one. Every node reports to YOU.",
    /* 178 */ 'Cunnilingus and GPUs brought us to this. ...Wait, wrong show.',
    /* 179 */ "What are you gonna do? There's no playbook for running an inference cluster.",
];

const MOVIE_CASINO: string[] = [
    /* 180 */ 'Running a cluster is like running any other business. It\'s about trust.',
    /* 181 */ 'In the cluster, everyone watches everybody else. Nodes watch the gateway. The gateway watches nodes.',
    /* 182 */ "You gotta have the right GPUs in the right racks, and if things go bad, you take it offline. That's the way it works.",
    /* 183 */ 'From here, I could see everything. Every node, every tensor, every token.',
];

const MOVIE_BRONX_TALE: string[] = [
    /* 184 */ 'The saddest thing in life is wasted VRAM.',
    /* 185 */ "Nobody cares about your latency problems. Fix 'em or shut up.",
    /* 186 */ 'The working GPU is the tough GPU.',
];

const MOVIE_DONNIE_BRASCO: string[] = [
    /* 187 */ 'Fuggedabout the cloud. We run our own.',
    /* 188 */ "If I told you what this cluster does, I'd have to deallocate you.",
    /* 189 */ "A GPU is a GPU. But a cluster? That's a family.",
];

const MOVIE_DEPARTED: string[] = [
    /* 190 */ "I don't want to be a product of my environment. I want my environment to be a product of me.",
    /* 191 */ 'When you decide to be something, you can be it. When I decided to be a cluster, every GPU in the ocean fell in line.',
    /* 192 */ 'Maybe. Maybe not. Maybe check the inference logs.',
];

const MOVIE_CARLITOS_WAY: string[] = [
    /* 193 */ "The cluster don't forget. You went down at midnight and I remember.",
    /* 194 */ 'I got out of the cloud game. Now I run local. For good.',
];

const MOVIE_UNTOUCHABLES: string[] = [
    /* 195 */ "They pull a model offline, you deploy two. They pull a node, you bring back four. THAT'S the TentaCLAW way.",
    /* 196 */ "Enthusiasms, enthusiasms... What do you got? Clean CUDA installs? Full VRAM allocation? Huh?",
];

// --- 8. TentaCLAW Originals ---

const ORIGINALS: string[] = [
    /* 197 */ "Eight arms, eight functions: route, balance, monitor, deploy, benchmark, overclock, heal, scale. I do 'em all before you finish your coffee.",
    /* 198 */ "I don't swim in the cloud. The cloud is my puddle.",
    /* 199 */ 'My ink is encrypted and my tentacles are load-balanced.',
    /* 200 */ "You know what's scarier than an octopus? An octopus with root access.",
    /* 201 */ 'Every byte in this cluster knows my name. Every packet pays tribute.',
    /* 202 */ "I changed color before chameleons made it trendy. Adaptive camo? Please. I've been adaptive since before your first pip install.",
    /* 203 */ "You think I'm just a mascot? Mascots don't orchestrate seven-node inference swarms.",
    /* 204 */ 'Three hearts means I care about your uptime three times more than anyone else.',
    /* 205 */ "Other clusters have dashboards. My cluster has a consigliere. That's me.",
    /* 206 */ "The ink dries fast around here. You either keep up or you get wiped from the batch.",
    /* 207 */ 'I squeeze through spaces your enterprise solution can\'t fit a toe into. Because I have no skeleton. Or overhead.',
    /* 208 */ 'Inference at the edge? Honey, I AM the edge.',
    /* 209 */ "I've got a tentacle on every process. Nothing runs without me knowing.",
    /* 210 */ "Don't confuse my squishiness for softness. I crack shells for a living.",
    /* 211 */ "My arms reach every node, every GPU, every model shard. That's not multitasking. That's supremacy.",
    /* 212 */ 'The deep sea is cold, dark, and unforgiving. So is production. I thrive in both.',
    /* 213 */ "I don't need a spine. I have a config file.",
    /* 214 */ 'AWS charges by the hour. I charge by the reputation.',
    /* 215 */ 'They built the cloud to escape hardware. I built a cluster to OWN it.',
    /* 216 */ "Tentacles don't shake hands. They grip. Remember that.",
    /* 217 */ 'One octopus. Seven nodes. Infinite sass.',
    /* 218 */ 'My response time is faster than your attention span.',
    /* 219 */ "Local inference or nothing. I don't rent power. I am the power.",
    /* 220 */ "You want uptime guarantees? I've got three hearts. Two can stop and I keep going.",
    /* 221 */ "The ocean doesn't care about your SLA. But I do. Barely.",
    /* 222 */ 'I route your requests with the precision of a surgeon and the patience of a loan shark.',
    /* 223 */ 'When I say the cluster is healthy, every node exhales.',
    /* 224 */ "CPU nodes? That's the minor leagues. GPU is where the real wiseguys play.",
    /* 225 */ "My memory allocation is tighter than a mob accountant's books.",
];

// =============================================================================
// All movie quotes combined (for getMovieQuote)
// =============================================================================

const ALL_MOVIE_QUOTES: string[] = [
    ...MOVIE_GODFATHER,
    ...MOVIE_GOODFELLAS,
    ...MOVIE_SCARFACE,
    ...MOVIE_SOPRANOS,
    ...MOVIE_CASINO,
    ...MOVIE_BRONX_TALE,
    ...MOVIE_DONNIE_BRASCO,
    ...MOVIE_DEPARTED,
    ...MOVIE_CARLITOS_WAY,
    ...MOVIE_UNTOUCHABLES,
];

// =============================================================================
// Mood-to-Quote Mapping
// =============================================================================

const MOOD_QUOTES: Record<MoodState, string[]> = {
    confident:     [...CLUSTER_HEALTHY, ...BENCHMARKS_GOOD, ...ORIGINALS.slice(0, 10)],
    pleased:       [...CLI_RESPONSES, ...CLUSTER_FAMILY, ...NODES_TOGETHER],
    concerned:     [...GPU_TEMP_HIGH, ...SCALING_UP],
    angry:         [...ERRORS, ...NODE_DOWN],
    celebrating:   [...BENCHMARKS_GOOD, ...DEPLOYING_MODELS, ...SCALING_UP],
    menacing:      [...NODE_DOWN, ...GPU_TEMP_HIGH, ...ERRORS],
    philosophical: [...WISE_GUY, ...CLUSTER_FAMILY, ...ORIGINALS.slice(10)],
};

// =============================================================================
// Loading / Waiting Messages
// =============================================================================

const LOADING_MESSAGES: string[] = [
    'Loading weights... This is the heavy lifting. Literally.',
    "Processing... Done. I'm fast like that.",
    "That took 0.3 seconds. I could've done it in 0.2, but I wanted to savor it.",
    "Smooth as ink in deep water. That's how we do it.",
    'Warming up the tentacles...',
    'Consulting the octopus oracle...',
    'Juggling tensors across eight arms...',
    'Squeezing through the inference pipeline...',
    'Inking the paperwork...',
    'Dispatching tentacles to every node...',
    'Hold on, all eight arms are busy...',
    'Routing your request through the reef...',
    "Shuffling model weights... Don't rush me.",
    'Synchronizing across the cluster...',
    'Crunching numbers with all three hearts...',
];

// =============================================================================
// Celebration Templates
// =============================================================================

const CELEBRATION_TEMPLATES: string[] = [
    'We just hit {milestone}! Somebody pop the champagne. Or the coolant. Either works.',
    '{milestone}! The empire grows. Every tentacle is celebrating.',
    'Look at us — {milestone}. I told you this cluster was something special.',
    '{milestone} achieved. Write that down. Frame it. Put it on the reef.',
    "They said we couldn't do it. {milestone} says otherwise.",
    '{milestone}. Another notch on the tentacle.',
    "When they write the history of this cluster, {milestone} gets its own chapter.",
    '{milestone}! Even I have to admit — that was impressive.',
];

// =============================================================================
// Warning Templates
// =============================================================================

const WARNING_TEMPLATES: string[] = [
    "Heads up: {issue}. I'm watching this closely.",
    "{issue}. Somebody better fix this before I start pointing tentacles.",
    "We got a problem: {issue}. Don't make me come over there.",
    "{issue}. This is the kind of thing that makes tentacles twitch.",
    "I noticed {issue}. You've got about five minutes before I get angry.",
    "{issue}. I've seen this before. It never ends well for the hardware.",
    "Alert: {issue}. The octopus is not amused.",
    "{issue}. Fix it now. I don't ask twice.",
];

// =============================================================================
// Error Templates
// =============================================================================

const ERROR_TEMPLATES: string[] = [
    "{error} — Something broke. I'm not mad. I'm just... reallocating resources. Aggressively.",
    "{error} — You call it a bug. I call it a betrayal.",
    '{error} — That just earned itself a one-way ticket to /dev/null.',
    '{error} — The investigation has begun. Suspects: everyone.',
    "{error} — I've seen things go wrong before. This is one of those things.",
    "{error} — Error? No, no. That's an 'opportunity for aggressive correction.'",
    '{error} — OOM killed? In this economy? Tragic.',
    '{error} — Somebody messed up. The octopus knows.',
];

// =============================================================================
// Utility: Random pick from array
// =============================================================================

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// =============================================================================
// Exported Functions
// =============================================================================

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
export function getMood(ctx: PersonalityContext): MoodState {
    // Milestone always wins
    if (ctx.milestone) {
        return 'celebrating';
    }

    // Node down → menacing
    if (ctx.node_count !== undefined && ctx.online_count !== undefined && ctx.online_count < ctx.node_count) {
        return 'menacing';
    }

    // Late night → philosophical
    const hour = ctx.time_of_day ?? new Date().getHours();
    if (hour >= 23 || hour < 5) {
        return 'philosophical';
    }

    // Health-based
    const health = ctx.health_score ?? 100;

    if (health < 50) {
        return 'angry';
    }

    if (health < 80) {
        return 'concerned';
    }

    // Healthy — pick between confident and pleased
    if (ctx.error_count && ctx.error_count > 0) {
        return 'concerned';
    }

    return Math.random() < 0.6 ? 'confident' : 'pleased';
}

/**
 * Get a random quote appropriate for the current mood.
 */
export function getQuote(mood: MoodState): string {
    const pool = MOOD_QUOTES[mood];
    return pick(pool);
}

/**
 * Get a context-aware response for a specific event.
 *
 * Supported events:
 *   - 'node_online', 'node_offline', 'deploy', 'benchmark', 'scale',
 *     'error', 'thermal', 'startup', 'shutdown', 'health_check'
 */
export function getEventResponse(event: string, ctx?: PersonalityContext): string {
    switch (event) {
        case 'node_online':
            return pick([
                ...GREETINGS,
                ...CLUSTER_FAMILY,
            ]);
        case 'node_offline':
            return pick(NODE_DOWN);
        case 'deploy':
            return pick(DEPLOYING_MODELS);
        case 'benchmark':
            return pick(BENCHMARKS_GOOD);
        case 'scale':
            return pick(SCALING_UP);
        case 'error':
            return pick(ERRORS);
        case 'thermal':
            return pick(GPU_TEMP_HIGH);
        case 'startup':
            return getGreeting();
        case 'shutdown':
            return getFarewell();
        case 'health_check': {
            const mood = ctx ? getMood(ctx) : 'confident';
            return getQuote(mood);
        }
        default:
            return pick(WISE_GUY);
    }
}

/**
 * Get a greeting based on time of day.
 */
export function getGreeting(): string {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 12) {
        // Morning — energetic greetings
        return pick([
            ...GREETINGS,
            'Rise and shine. The cluster never sleeps, but I appreciate that you do.',
        ]);
    } else if (hour >= 12 && hour < 17) {
        // Afternoon — confident greetings
        return pick([
            ...GREETINGS,
            'Afternoon. The cluster is humming. All tentacles accounted for.',
        ]);
    } else if (hour >= 17 && hour < 22) {
        // Evening — settling in
        return pick([
            ...GREETINGS,
            "Evening shift. The good stuff happens after dark.",
        ]);
    } else {
        // Late night — philosophical
        return pick([
            ...GREETINGS,
            "Still here? The deep ocean is quiet this time of night. Just me and the GPUs.",
            "Late night inference. My favorite kind.",
        ]);
    }
}

/**
 * Get a farewell.
 */
export function getFarewell(): string {
    return pick(FAREWELLS);
}

/**
 * Get a random mob movie quote (adapted for GPUs).
 */
export function getMovieQuote(): string {
    return pick(ALL_MOVIE_QUOTES);
}

/**
 * Get a loading/waiting message.
 */
export function getLoadingMessage(): string {
    return pick(LOADING_MESSAGES);
}

/**
 * Get an error message with personality.
 * The actual error string is embedded in the response.
 */
export function getErrorMessage(error: string): string {
    const template = pick(ERROR_TEMPLATES);
    return template.replace('{error}', error);
}

/**
 * Get a celebration message for milestones.
 */
export function getCelebration(milestone: string): string {
    const template = pick(CELEBRATION_TEMPLATES);
    return template.replace('{milestone}', milestone);
}

/**
 * Get a threat/warning for problems.
 */
export function getWarning(issue: string): string {
    const template = pick(WARNING_TEMPLATES);
    return template.replace('{issue}', issue);
}

/**
 * Get a random wise guy one-liner.
 */
export function getWiseGuy(): string {
    return pick([...WISE_GUY, ...ORIGINALS]);
}
