# TentaCLAW OS v3.0 — Launch Checklist

> Week-by-week execution plan for a viral launch.
> Target: Tuesday launch on HN, midnight launch on Product Hunt.
> All dates relative to Launch Day (Week 0, Day 0 = Launch Tuesday).

---

## Week -4: Foundation (Days -28 to -22)

### Video & Demo
- [ ] Record full 3-minute demo video (see LAUNCH-VIDEO-SCRIPT.md)
- [ ] Record all terminal footage with real commands on real hardware
- [ ] Record dashboard footage (5 nodes, healthy cluster, GPU stats)
- [ ] Record hardware b-roll (desk, rigs, cables, GPUs visible)
- [ ] Edit 3-minute full cut
- [ ] Edit 60-second social cut
- [ ] Edit 15-second ad cut
- [ ] Create 10-second GIF (boot + dashboard + deploy + vibe)
- [ ] Create demo thumbnail (CLAWtopus ASCII + "5 GPUs, 1 Brain")
- [ ] Upload to YouTube (unlisted, schedule for launch day)

### Community Setup
- [ ] Create Discord server ("The Tank")
- [ ] Set up channels: #general, #support, #terminal-showoff, #feature-requests, #announcements
- [ ] Write welcome message with CLAWtopus ASCII art
- [ ] Set up moderation bot
- [ ] Create invite link (permanent, vanity URL if possible)
- [ ] Recruit 5-10 early supporters as Discord seed members

### Build-in-Public (Start Posting)
- [ ] Twitter: Post #1 — "Building an OS for GPU inference clusters. 59K lines so far."
- [ ] Twitter: Post #2 — "The mascot is an octopus. Her name is CLAWtopus. She has opinions."
- [ ] Twitter: Post #3 — Screenshot of boot splash
- [ ] Twitter: Post #4 — Architecture diagram or decision doc
- [ ] Twitter: Post #5 — "How many GPUs is too many? Asking for a friend."
- [ ] Set up @TentaCLAW_OS Twitter account if not done
- [ ] Update Twitter bio with one-liner and website

### Benchmarks
- [ ] Run inference benchmarks on real hardware (tok/s per model per GPU)
- [ ] Run distributed inference benchmarks (2-node, 3-node, 5-node)
- [ ] Run cost comparison calculations (vs OpenAI, Anthropic, Together, RunPod)
- [ ] Document all benchmark methodology (reproducible)
- [ ] Create benchmark results table (formatted for README and blog)

---

## Week -3: Content (Days -21 to -15)

### Blog Posts (Draft)
- [ ] Blog #1: "Why We Built TentaCLAW OS" (origin story, problem statement, vision)
- [ ] Blog #2: "How Auto-Discovery Works" (technical deep-dive, mDNS, UDP broadcast, zero-config)
- [ ] Blog #3: "Distributed Inference on Consumer GPUs" (how model splitting works, NVIDIA + AMD)
- [ ] Blog #4: "The True Cost of Cloud AI" (cost comparison with real numbers)
- [ ] Blog #5: "CLAWHub: 162 Packages for Your GPU Cluster" (ecosystem overview)
- [ ] Publish on Dev.to, Hashnode, or personal blog (schedule for launch week)

### Awesome Lists & Directories
- [ ] Submit to awesome-selfhosted (PR ready, don't submit yet)
- [ ] Submit to awesome-llm
- [ ] Submit to awesome-homelab
- [ ] Submit to awesome-sysadmin
- [ ] Submit to AlternativeTo (alternative to: RunPod, Lambda, Vast.ai)
- [ ] List on SourceForge
- [ ] List on LibHunt

### Newsletter & Press Pitches (Draft)
- [ ] Draft pitch for TLDR Newsletter
- [ ] Draft pitch for Console.dev
- [ ] Draft pitch for Changelog
- [ ] Draft pitch for The Pragmatic Engineer (enterprise angle)
- [ ] Draft pitch for Import AI
- [ ] Draft pitch for relevant AI/ML newsletters
- [ ] Create press kit (one-pager PDF: what it is, screenshots, stats, quotes)

### Screenshots
- [ ] screenshot-boot.png (CLAWtopus boot splash, clean, high contrast)
- [ ] screenshot-dashboard.png (5 nodes, healthy, GPU stats visible)
- [ ] screenshot-cli-deploy.png (clawtopus deploy command output)
- [ ] screenshot-cli-chat.png (inference response streaming)
- [ ] screenshot-cost.png (cost intelligence output with savings)
- [ ] screenshot-vibe.png (clawtopus vibe output)
- [ ] screenshot-clawhub.png (hub search + install)
- [ ] social-banner.png (1500x500 for Twitter/GitHub: logo + tagline)
- [ ] og-image.png (1200x630 for link previews)

---

## Week -2: Platform Prep (Days -14 to -8)

### Product Hunt
- [ ] Create Product Hunt upcoming page
- [ ] Write tagline: "Your GPUs. One brain. Zero limits."
- [ ] Write description (250 words: what, why, for whom)
- [ ] Upload 5 gallery images (boot, dashboard, deploy, cost, vibe)
- [ ] Upload demo video (60-second cut)
- [ ] Select topics: Developer Tools, Artificial Intelligence, Open Source, DevOps
- [ ] Add makers
- [ ] Schedule launch for midnight PT on Launch Tuesday
- [ ] Coordinate with 5+ hunters for early upvotes

### Press Kit
- [ ] One-page PDF: product name, one-liner, 3 screenshots, key stats, links
- [ ] Logo files (PNG, SVG, dark/light variants)
- [ ] CLAWtopus mascot files (PNG, high-res)
- [ ] Brand guidelines (colors: cyan #00FFFF, purple #8C00C8, teal #008C8C)
- [ ] Founder bio + headshot
- [ ] Key stats: 59K lines, 162 packages, 6 backends, 72 API endpoints

### Benchmark Data (Finalize)
- [ ] Create benchmark comparison chart (image, for social sharing)
- [ ] Write benchmark methodology document (link from README)
- [ ] Verify all numbers are reproducible
- [ ] Get at least one external validation (friend runs benchmarks independently)

### GitHub Repo Polish
- [ ] README hero section: one-liner + demo GIF + quick start
- [ ] README badges: version, license, stars, Discord
- [ ] CONTRIBUTING.md finalized
- [ ] LICENSE file confirmed
- [ ] Release notes drafted for v3.0
- [ ] GitHub release (draft, not published)
- [ ] Pin demo GIF to top of README
- [ ] Add social preview image (og-image.png)
- [ ] Verify all quick start commands work on fresh machine
- [ ] Verify install script works: `curl -fsSL tentaclaw.io/install | bash`

### Website
- [ ] tentaclaw.io landing page live (or redirect to GitHub)
- [ ] Install script hosted at tentaclaw.io/install
- [ ] Docs hosted (GitHub Pages, Docusaurus, or similar)
- [ ] Analytics installed (Plausible or similar, not Google)

---

## Week -1: Final Prep (Days -7 to -1)

### Testing
- [ ] Full end-to-end test: fresh install on bare metal
- [ ] Full end-to-end test: fresh install via Docker/VM
- [ ] Test install script on Ubuntu 22.04, 24.04, Debian 12
- [ ] Test with NVIDIA GPU (CUDA path)
- [ ] Test with AMD GPU (ROCm path)
- [ ] Test CPU-only mode
- [ ] Test distributed inference (2+ nodes)
- [ ] Test CLAWHub package install
- [ ] Test fine-tuning flow
- [ ] Test cost intelligence
- [ ] Verify all screenshots match current UI
- [ ] Load test: 100 concurrent inference requests

### Early Supporter Coordination
- [ ] Email/DM 20+ people who expressed interest
- [ ] Ask 10+ people to star the repo on launch morning
- [ ] Ask 5+ people to upvote on Product Hunt at midnight
- [ ] Ask 3+ people to comment on the HN post within first hour
- [ ] Brief supporters on talking points (what to say, what to emphasize)
- [ ] Share draft HN post for feedback
- [ ] Share draft Reddit posts for feedback

### Draft All Posts
- [ ] HN post: "Show HN: TentaCLAW OS v3.0 — GPU inference cluster OS" (see LAUNCH_POSTS.md)
- [ ] Reddit r/LocalLLaMA post (see ELEVATOR-PITCHES.md for angle)
- [ ] Reddit r/selfhosted post
- [ ] Reddit r/homelab post
- [ ] Reddit r/MachineLearning post (if appropriate)
- [ ] Twitter launch thread (5-7 posts)
- [ ] Discord announcement for The Tank
- [ ] Dev.to cross-post of "Why We Built TentaCLAW OS"
- [ ] LinkedIn post (enterprise angle)
- [ ] Email to newsletter editors (final pitch)

### Day -1 (Monday)
- [ ] Publish GitHub release (v3.0)
- [ ] Verify all links work
- [ ] Verify Discord invite link works
- [ ] Verify install script works one more time
- [ ] Stage all social posts in drafts (copy-paste ready)
- [ ] Get 8 hours of sleep

---

## Week 0: LAUNCH (Days 0 to 6)

### Day 0 — Launch Tuesday

**Midnight PT (Product Hunt)**
- [ ] Product Hunt page goes live automatically
- [ ] Post in Discord: "We're live on Product Hunt!"
- [ ] DM early supporters: "We're live, upvote link: [url]"

**9:00 AM ET (Hacker News)**
- [ ] Submit "Show HN" post
- [ ] Share HN link in Discord
- [ ] Share HN link with supporters for early comments
- [ ] Do NOT ask people to upvote HN (against rules) — ask them to comment authentically

**10:00 AM ET (Reddit Blitz)**
- [ ] Post to r/LocalLLaMA
- [ ] Post to r/selfhosted (30 min after LocalLLaMA)
- [ ] Post to r/homelab (30 min after selfhosted)

**11:00 AM ET (Twitter)**
- [ ] Post launch thread (5-7 posts)
- [ ] Pin thread to profile
- [ ] Quote-tweet with demo GIF

**12:00 PM ET (Everywhere Else)**
- [ ] Post on LinkedIn
- [ ] Post on Dev.to
- [ ] Send newsletter pitch emails
- [ ] Cross-post in relevant Discord servers (AI, homelab, self-hosted)

**All Day**
- [ ] Monitor HN comments — respond to every question within 30 minutes
- [ ] Monitor Reddit comments — respond to every question
- [ ] Monitor Product Hunt comments
- [ ] Monitor Discord
- [ ] Monitor Twitter mentions and replies
- [ ] Track metrics: GitHub stars, HN rank, PH rank, Discord members
- [ ] Screenshot milestone moments (100 stars, front page, etc.)

### Day 1 — Wednesday: Follow Through
- [ ] Write "Thank you" post on Twitter (with metrics)
- [ ] Respond to remaining comments across all platforms
- [ ] Track and document recurring questions/confusion points
- [ ] Fix any critical bugs reported by users (hotfix if needed)
- [ ] Update FAQ based on launch feedback

### Day 2-3 — Thursday/Friday: Deep Engagement
- [ ] Publish blog post #2 (technical deep-dive, timed for ongoing interest)
- [ ] Post on r/MachineLearning if not done on launch day
- [ ] Respond to any blog/newsletter coverage
- [ ] Create issue labels for first-time contributors
- [ ] Tag easy issues as "good first issue"

### Day 4-6 — Weekend: Let It Breathe
- [ ] Collect screenshots of user terminals, dashboards, reactions
- [ ] Compile a "Week 1 by the numbers" post for next week
- [ ] Plan quick-fix release based on feedback
- [ ] Rest

---

## Week +1: Consolidation (Days 7 to 13)

### Quick-Fix Release
- [ ] Triage all issues from launch week
- [ ] Ship v3.0.1 with top user-reported fixes
- [ ] Announce release on Discord, Twitter, GitHub

### Respond to Everything
- [ ] Reply to every GitHub issue (even if just acknowledging)
- [ ] Reply to every Discord question
- [ ] Reply to any blog posts or articles mentioning TentaCLAW
- [ ] Thank anyone who shared or wrote about the project

### Retrospective
- [ ] Write internal retro: what worked, what didn't, what to do next time
- [ ] Publish "Launch Week Retro" blog post (transparency builds trust)
- [ ] Share key metrics: stars, forks, Discord members, downloads, HN rank peak

### Community Building
- [ ] Identify top contributors/supporters from launch week
- [ ] DM them — invite to a closer circle or early access
- [ ] Set up weekly Discord voice chat or AMA
- [ ] Create #build-in-public channel in Discord

### Content
- [ ] Post "Week 1 by the numbers" on Twitter
- [ ] Submit to any awesome lists you deferred
- [ ] Update README based on first-user confusion points

---

## Week +2 to +4: Content Flywheel (Days 14 to 28)

### Weekly Blog/Video Cadence
- [ ] Week +2: Blog — "Distributed Inference Explained" + YouTube walkthrough
- [ ] Week +3: Blog — "Fine-Tuning on Consumer GPUs" + YouTube tutorial
- [ ] Week +4: Blog — "CLAWHub Deep Dive: 5 Packages You Should Install"

### Podcast & Interview Circuit
- [ ] Pitch to Changelog podcast
- [ ] Pitch to Self-Hosted podcast (Jupiter Broadcasting)
- [ ] Pitch to Practical AI podcast
- [ ] Pitch to Ship It! podcast
- [ ] Pitch to relevant AI/ML YouTube channels
- [ ] Pitch to homelab YouTube channels (TechnoTim, NetworkChuck, Jeff Geerling)

### Ongoing Social
- [ ] Follow the SOCIAL-CALENDAR.md plan
- [ ] Post 3-5x per week on Twitter (mix of build-in-public, screenshots, hot takes)
- [ ] Engage in r/LocalLLaMA threads organically (help people, mention TentaCLAW when relevant)
- [ ] Cross-post blog content to Dev.to, Hashnode, Medium

### Community Growth
- [ ] Weekly Discord AMA or voice chat
- [ ] "Terminal Showoff" contest in Discord (best CLAWtopus screenshot wins stickers)
- [ ] Sticker/merch drop for early supporters
- [ ] Feature community contributions in release notes
- [ ] Create contributor spotlight posts

### Growth Metrics to Track
| Metric | Week 0 Target | Week +4 Target |
|--------|---------------|----------------|
| GitHub stars | 500 | 2,000 |
| Discord members | 50 | 300 |
| Weekly downloads | 100 | 500 |
| Blog post views | 5,000 | 20,000 |
| Twitter followers | 200 | 1,000 |
| Contributors | 1 | 10 |
| CLAWHub packages installed | 50 | 500 |

---

## Launch Day War Room Setup

### Screens
1. HN front page (refresh every 5 min)
2. Product Hunt dashboard
3. GitHub repo (watch stars in real-time)
4. Twitter notifications
5. Discord

### Team Assignments (Solo Founder Variant)
- 9 AM - 12 PM: Post everything, respond to early comments
- 12 PM - 3 PM: Deep engagement on HN and Reddit (this is where credibility is built)
- 3 PM - 6 PM: Respond to Twitter, cross-platform cleanup
- 6 PM - 9 PM: Evening check, respond to international audience
- 9 PM: Step away. It either works or it doesn't. Sleep.

### Emergency Protocols
- **Install script broken:** Fix immediately, push hotfix, post update in all threads
- **Major bug reported:** Acknowledge publicly within 15 min, fix within 2 hours
- **Negative HN thread:** Respond with facts and humility, never argue
- **Server/website down:** Switch to GitHub-only links, post status update
- **Going viral beyond capacity:** Celebrate, but don't promise what you can't deliver

---

## Post-Launch Mantra

> The mascot gets attention.
> The proof gets adoption.
> The response to feedback gets loyalty.
>
> Ship fast. Reply faster. Build in public.
