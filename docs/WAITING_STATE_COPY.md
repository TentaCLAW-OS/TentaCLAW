# Waiting-State Copy Research

Built from:
- [`cephalopod-mythology-research.txt`](../cephalopod-mythology-research.txt)
- [`cephalopod-mythology-research-EXTENDED.txt`](../cephalopod-mythology-research-EXTENDED.txt)
- Existing product voice in `BRAND.md`, `MEME_TEMPLATES.md`, and the gateway UI

## Goal

Create wait-state copy that does three jobs at once:

1. Tells the user what is actually happening.
2. Makes the delay feel shorter.
3. Reinforces the CLAWtopus / deep-sea / mythic brand without becoming annoying.

## What The Research Says

### 1. Status first, joke second

The strongest UX rule is still visibility of system status: users should know what is happening, quickly and clearly. If a line is funny but does not explain the real state, it fails.

Practical rule:
- First line = operational truth.
- Second line = flavor, joke, or fact.

Good:
- `Downloading model weights...`
- `CLAWtopus is hauling them up from the abyss.`

Bad:
- `Summoning the ancient one...`

Why it is bad:
- It sounds on-brand, but it does not tell the user whether the system is downloading, verifying, retrying, or stuck.

### 2. Humor works best as garnish

Playful copy helps on short and medium waits, but repeated exposure makes weak jokes wear out fast. The humor should be light, skimmable, and optional.

Practical rule:
- Keep jokes to one beat.
- Rotate lines so the same joke does not repeat every session.
- If the wait becomes long, switch from cute to honest.

### 3. Strong microcopy uses short, direct verbs

The best interface copy stays clear, concise, and action-oriented. For wait states, verbs matter more than adjectives.

Preferred verbs:
- `Loading`
- `Downloading`
- `Verifying`
- `Warming up`
- `Registering`
- `Syncing`
- `Crunching`
- `Assembling`
- `Rendering`

Avoid vague filler:
- `Doing magic`
- `Working on it`
- `Handling stuff`

### 4. Match the copy to the certainty of the progress

If you know what stage the system is in, name the stage. If you know percent complete, show it. If you do not know duration, say what is happening instead of pretending to know time.

Pattern:
- Determinate: `Downloading model... 62%`
- Indeterminate: `Verifying model integrity...`

### 5. Empty states need explanation, not just personality

When nothing is happening yet, users still need orientation. The right empty-state formula is:

`What is missing` + `what the system is waiting for` + `what happens next`

Example:
- `No workers connected.`
- `Waiting for agents to register with the gateway.`
- `Once a node checks in, CLAWtopus will wake the dashboard.`

### 6. Facts and mythology beat random jokes

The strongest “fun while you wait” content in this brand is not generic internet humor. It is:

- true cephalopod biology
- strange historical sea-monster lore
- deep-sea pseudo-drama tied to the actual task

That makes the wait content feel authored instead of disposable.

### 7. Long waits need an escalation ladder

A single tone should not cover every delay. A 2-second wait can be mischievous. A 45-second wait needs reassurance.

Suggested ladder:
- `0-3s`: quick playful status
- `3-10s`: status + joke or fact
- `10-30s`: status + fact + progress hint
- `30s+`: honest explanation, next expectation, optional retry/help text

## Brand Formula For Strong Wait Copy

### Core formula

Use this structure for most lines:

`[Real system action] + [cephalopod image] + [tiny punchline]`

Examples:
- `Verifying model checksum... counting suckers twice.`
- `Loading cluster summary... eight arms, one inventory.`
- `Generating results... the ink is still drying.`

### Tone rules

The CLAWtopus voice works best when it feels:
- competent
- slightly smug
- weird in a deliberate way
- never confusing
- never desperate for laughs

### Joke construction patterns

#### Pattern A: Literal status + sea metaphor
- `Fetching workers from the reef...`
- `Pulling benchmarks up from the trench...`

#### Pattern B: Myth reference + modern task
- `Kraken-scale download in progress.`
- `Scylla-level traffic. Still under control.`

#### Pattern C: Biology fact + system behavior
- `Three hearts. Zero downtime.`
- `Camouflaging latency with professionalism.`

#### Pattern D: Fake confidence
- `Totally intentional turbulence.`
- `Nothing ominous. Just distributed systems.`

#### Pattern E: Tiny reversal
- `Stretching all eight arms. No, wait, loading first.`
- `Results are surfacing. Dramatically, of course.`

## What To Avoid

- Do not hide failure behind humor.
- Do not use lore that sounds like data loss, drowning, death, or madness during normal tasks.
- Do not make every line a full sentence plus a punchline plus a fact. That becomes noisy.
- Do not use heavy Lovecraft language in basic flows unless the product explicitly wants horror. It can read as hostile instead of fun.
- Do not overuse the same nouns: `abyss`, `depths`, `kraken`, `ink`, `tentacles`.
- Do not joke when the user needs a fix, retry, auth step, or network explanation.

## Recommended Wait-State Architecture

For the product, use three content layers:

### Layer 1: Primary status

Always visible, operational, plain-English.

Examples:
- `Downloading model`
- `Verifying model`
- `Waiting for workers`
- `Generating response`

### Layer 2: Flavor line

Optional rotation under the main status.

Examples:
- `CLAWtopus is hauling this one in by tentacle.`
- `A polite amount of abyssal drama is occurring.`

### Layer 3: Rotating fact or myth

Best for waits longer than a few seconds.

Examples:
- `Cephalopod fact: octopuses have three hearts.`
- `Myth note: hafgufa looked so large sailors mistook it for an island.`

## Catch Phrase Bank

Use these as short rotating secondary lines.

### General loading

- `Stretching all eight arms.`
- `Surfacing with your data.`
- `Untangling tentacles.`
- `A little ink, a lot of progress.`
- `Waking the deep-sea department.`
- `Aligning suckers and circuits.`
- `Calm sea. Busy cluster.`
- `Just enough drama to feel premium.`
- `Rising from the trench.`
- `Warming up the abyss.`
- `The reef is thinking.`
- `Keeping it mysterious, not broken.`

### Downloading

- `Hauling bytes up from the seafloor.`
- `Kraken-class payload incoming.`
- `Net full of model weights.`
- `Reeling it in.`
- `Dragging the catch onboard.`
- `Deep-sea freight is on schedule.`
- `A large and suspiciously intelligent package is arriving.`
- `Pulling another relic from the depths.`
- `Tentacles on the download line.`
- `Fresh cargo from the trench.`

### Verifying / installing

- `Counting every sucker twice.`
- `Making sure the beast is house-trained.`
- `Checking the seals before release.`
- `Inspecting for cursed artifacts.`
- `Professional paranoia in progress.`
- `Trust, but verify. Then verify again.`
- `Confirming this creature is genuine.`
- `No counterfeit krakens allowed.`

### Processing / generating results

- `The ink is still drying.`
- `Assembling something slippery and useful.`
- `The answer is surfacing now.`
- `Crunching with unnerving grace.`
- `Tentacles in motion.`
- `Deep thought requires saltwater.`
- `Disturbing the sand in a productive way.`
- `One mind. Eight parallel impulses.`
- `Polishing the final splash.`
- `Results incoming with unnecessary elegance.`

### Waiting for agents / workers / nodes

- `Listening for movement below the surface.`
- `Waiting for more arms to join the swarm.`
- `The reef is quiet. For now.`
- `No workers yet. The water is still.`
- `Scanning the tide for new arrivals.`
- `Waiting for the shoal to form.`
- `CLAWtopus is watching the gateway.`
- `No node has breached the surface yet.`

## Primary + Secondary Pairings

These are ready-to-use combinations.

### Loading dashboard data

- `Loading cluster summary...`
  `Eight arms. One inventory.`
- `Fetching node status...`
  `Listening for clicks in the reef.`
- `Loading farm hash...`
  `A true name takes a second.`

### Downloading a model

- `Downloading model weights...`
  `Hauling bytes up from the seafloor.`
- `Pulling model to node...`
  `Reeling in a kraken-sized package.`
- `Downloading runtime components...`
  `Abyssal freight is en route.`

### Verifying a download

- `Verifying model integrity...`
  `Counting every sucker twice.`
- `Checking package contents...`
  `Making sure the tentacles all match.`
- `Finalizing install...`
  `No counterfeit sea monsters permitted.`

### Generating a result

- `Generating response...`
  `The ink is still drying.`
- `Processing request...`
  `One mind. Eight parallel impulses.`
- `Compiling results...`
  `Surfacing with something useful.`

### Empty / idle states

- `No workers connected.`
  `Waiting for agents to register with the gateway.`
  `Once they surface, CLAWtopus will take attendance.`
- `No benchmarks yet.`
  `Run a test and we will chart the catch.`
- `No alerts right now.`
  `The sea is calm. Suspiciously calm.`

## Rotating Fact Bank

These should be true, short, and easy to scan.

### Biology facts

- `Cephalopod fact: octopuses have three hearts.`
- `Cephalopod fact: their blood is blue because it uses copper-rich hemocyanin.`
- `Cephalopod fact: octopuses can squeeze through openings barely larger than their beak.`
- `Cephalopod fact: suckers can taste as well as grip.`
- `Cephalopod fact: many cephalopods use jet propulsion to move fast.`
- `Cephalopod fact: cuttlefish are masters of camouflage even though they are colorblind.`
- `Cephalopod fact: octopus arms can keep handling simple tasks semi-independently.`
- `Cephalopod fact: Aristotle described octopus ink defense over two thousand years ago.`

### Myth and lore facts

- `Myth note: Scylla was the original “pick the less bad option” sea monster.`
- `Myth note: the kraken was once described as so large sailors mistook it for an island.`
- `Myth note: hafgufa lured fish into its open mouth like a living fjord.`
- `Myth note: Akkorokamui was a giant red octopus spirit associated with healing and regeneration.`
- `Myth note: the lusca was said to haunt blue holes in the Bahamas.`
- `Myth note: one Ainu story describes a giant octopus glowing red across sea and sky.`

### Slightly punchier fact versions

- `Three hearts. Better uptime than most startups.`
- `Blue blood. No aristocracy required.`
- `A sucker can grip and taste. Efficient little overachiever.`
- `Jet propulsion: because walking is for amateurs.`
- `Camouflage so good it looks like packet loss.`

## Fun Stuff Beyond One-Liners

### Fake telemetry

Best for medium waits when the interface can rotate multiple lines.

- `Calibrating tentacle alignment...`
- `Checking abyssal pressure... stable`
- `Consulting the reef archives...`
- `Removing unauthorized barnacles...`
- `Reassuring the GPUs...`
- `Politely ignoring ancient whispers...`

### Tiny poems

- `Loading the answer,`
  `quiet as a hunting squid,`
  `then all at once: ink.`

- `Down in colder code,`
  `eight arms pass the work around,`
  `results rise slowly.`

### Myth cards

Show one sentence per long wait:

- `Scylla punished sailors who got too close. Our version just verifies checksums.`
- `The kraken dragged ships under. Ours mostly drags models onto nodes.`
- `Akkorokamui could regenerate lost limbs. Handy attitude for distributed systems.`
- `Hafgufa looked like an island until it opened its mouth. Good reminder to label state clearly.`

### Waiting-room banter

Use rarely, mostly for CLI or rotating dashboard flavor.

- `If this takes longer than a kraken nap, we will tell you.`
- `Nothing is wrong. Something large is merely turning around.`
- `Professional tentacle activity detected.`
- `This delay has been approved by marine legend.`
- `Your patience has been noticed by the undersea council.`

## Severity Ladder

### Short wait

Keep it simple:
- `Loading cluster summary...`
- `Stretching all eight arms.`

### Medium wait

Use status plus one fun line:
- `Downloading model weights...`
- `Hauling bytes up from the seafloor.`

### Long wait

Add clarity:
- `Downloading model weights...`
- `Large models can take a minute depending on node bandwidth.`
- `Still hauling cargo from the trench.`

### Problem state

Drop the comedy and help the user recover:
- `Download stalled.`
- `The node has not reported progress for 10 minutes.`
- `Retry the pull or inspect node connectivity.`

## Suggested Repo-Specific Rewrites

Based on current surfaces in the repo:

### Gateway empty state

Current:
- `No workers connected`
- `Waiting for agents to register with the gateway.`

Recommended variants:
- `No workers connected`
  `Waiting for agents to register with the gateway.`
  `Once they surface, CLAWtopus will wake the board.`

- `No workers connected`
  `The water is still. Waiting for the first node to check in.`

### Generic `Loading...`

Replace with stage-specific lines where possible:
- `Loading cluster summary...`
- `Loading node inventory...`
- `Loading farm hash...`
- `Loading model catalog...`

Secondary flavor options:
- `Untangling tentacles.`
- `Rising from the trench.`
- `Deep thought, shallow latency.`

### Model pull statuses

For `downloading`:
- `Downloading model weights...`
- `Kraken-class cargo inbound.`

For `verifying`:
- `Verifying model integrity...`
- `Counting every sucker twice.`

For `complete`:
- `Model ready.`
- `Catch secured.`

For `error`:
- `Pull failed.`
- `The sea got rough. Check node logs and retry.`

## Copy System Recommendation

Build a small rotation set per state instead of one global list.

Target:
- 6 to 10 flavor lines per common state
- 8 to 12 science facts
- 6 to 8 mythology cards
- 2 to 3 honest long-wait explanations

That is enough variety without making the voice feel random.

## Best Source Pools For This Brand

Strong source categories for future additions:
- real cephalopod biology
- classical sea-monster literature
- Norse and Ainu octopus lore
- submarine / oceanographic language
- fake industrial diagnostics written in a deadpan tone

Weak source categories:
- generic meme slang
- random internet loading jokes
- jokes that could fit any startup
- horror references in routine flows

## Sources

- Nielsen Norman Group, visibility of system status:
  https://www.nngroup.com/articles/visibility-system-status/
- Nielsen Norman Group guidance on loading-status indicators:
  https://media.nngroup.com/media/reports/free/Website_Tools_and_Applications_with_Flash.pdf
- Microsoft Writing Style Guide:
  https://learn.microsoft.com/en-us/style-guide/
- Mailchimp Content Style Guide:
  https://styleguide.mailchimp.com/web-elements/
- Smithsonian Ocean, cephalopod biology:
  https://ocean.si.edu/ocean-life/invertebrates/cephalopods
- Smithsonian Ocean, camouflage:
  https://ocean.si.edu/ocean-life/invertebrates/masters-disguise
