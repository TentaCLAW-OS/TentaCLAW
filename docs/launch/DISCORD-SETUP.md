# Discord Server Setup Guide

**Server Name:** TentaCLAW -- The Tank

**Server Icon:** CLAWtopus logo (octopus with GPU arms)

**Server Banner:** Dark background, TentaCLAW OS branding, tagline "Eight arms. One mind. Zero limits."

---

## Category & Channel Structure

### WELCOME
| Channel | Type | Purpose |
|---------|------|---------|
| `#welcome` | Text (read-only) | Welcome message, rules, getting started links |
| `#rules` | Text (read-only) | Community rules |
| `#introductions` | Text | New members introduce themselves and their setups |
| `#roles` | Text (read-only) | Role selection info |

### COMMUNITY
| Channel | Type | Purpose |
|---------|------|---------|
| `#general` | Text | General discussion, off-topic, chat |
| `#showcase` | Text | Show off your cluster, dashboards, setups |
| `#help-getting-started` | Text | New user questions, installation help |
| `#memes` | Text | CLAWtopus memes, GPU humor, inference shitposting |

### SUPPORT
| Channel | Type | Purpose |
|---------|------|---------|
| `#support` | Text | Technical support, troubleshooting |
| `#bug-reports` | Forum | Structured bug reports (template provided) |
| `#feature-requests` | Forum | Feature requests with discussion threads |
| `#hardware` | Text | GPU compatibility, hardware recommendations, build advice |

### DEVELOPMENT
| Channel | Type | Purpose |
|---------|------|---------|
| `#development` | Text | Technical discussion, architecture, code reviews |
| `#pull-requests` | Text | PR discussion, review requests |
| `#releases` | Text (read-only) | Release announcements, changelogs |
| `#github-feed` | Text (read-only) | Automated GitHub notifications |

### ANNOUNCEMENTS
| Channel | Type | Purpose |
|---------|------|---------|
| `#announcements` | Text (read-only) | Major announcements, launches, events |
| `#roadmap` | Text (read-only) | Roadmap updates, milestone progress |
| `#blog` | Text (read-only) | Blog posts, tutorials, guides |

### VOICE
| Channel | Type | Purpose |
|---------|------|---------|
| `The Ink Den` | Voice | General voice chat |
| `Pair Programming` | Voice | Working sessions, screen sharing |
| `Community Call` | Stage | Monthly community calls |

---

## Roles

| Role | Color | Permissions | Assignment |
|------|-------|-------------|------------|
| `@Team` | `#8b5cf6` (purple) | Admin, manage channels, pin messages | Manual (core team) |
| `@Contributors` | `#00d4aa` (teal) | Send messages in dev channels, early access | Earned via merged PR |
| `@Community` | `#4f8fff` (blue) | Default member role | Auto-assigned on join |
| `@Beta Testers` | `#ffdd00` (yellow) | Access to beta channels | Opt-in or selected |
| `@CLAWHub Authors` | `#ff6b6b` (coral) | Access to package dev channel | Earned via published package |

---

## Welcome Message

Post in `#welcome` (with CLAWtopus ASCII art as an image):

```
Welcome to The Tank.

TentaCLAW OS is an open-source AI inference cluster operating system.
We turn scattered GPUs into one self-healing cluster.
This is where the community lives.

GET STARTED
  Read the docs   → https://github.com/TentaCLAW-OS/TentaCLAW
  Install          → curl -fsSL https://tentaclaw.io/install | bash
  Dashboard demo   → docker compose up
  CLI reference    → https://github.com/TentaCLAW-OS/TentaCLAW/blob/master/docs/CLI.md

NEED HELP?
  #help-getting-started — new user questions
  #support              — technical troubleshooting
  #bug-reports          — found a bug? report it here
  #feature-requests     — got an idea? we're listening

WANT TO CONTRIBUTE?
  #development    — technical discussion
  #pull-requests  — PR reviews and feedback
  Look for `clawtopus-wanted` issues on GitHub

SHOW OFF YOUR SETUP
  #showcase — post screenshots of your cluster, your dashboard, your rig

CLAWtopus says: "Welcome to The Tank. Eight arms, one community.
Don't be a stranger — we don't bite. Well, I have a beak,
but I only use it on bad PRs."
```

---

## Rules

Post in `#rules`:

```
THE TANK RULES

1. Be respectful. No harassment, no discrimination, no personal attacks.
   We're here to build cool stuff together.

2. Stay on topic. Use the right channel. GPU questions go in #hardware,
   bugs go in #bug-reports, memes go in #memes.

3. No spam. No unsolicited DMs. No crypto shilling.
   We left that world to build AI infrastructure.

4. Search before asking. Check the docs, the FAQ, and existing threads
   before posting a support question.
   https://github.com/TentaCLAW-OS/TentaCLAW/blob/master/docs/FAQ.md

5. Share your knowledge. If you solved a problem, share the solution.
   Help the next person who hits the same wall.

6. Report bugs properly. Use the template in #bug-reports.
   Include your OS, GPU, TentaCLAW version, and steps to reproduce.

7. Be patient. This is an open-source project. Maintainers are volunteers.
   Response times vary.

8. No NSFW content. Keep it professional.

Violating these rules may result in a warning, mute, or ban
depending on severity.
```

---

## Bot Setup

### 1. GitHub Bot (Notifications)

**Recommended:** [GitHub Discord Integration](https://github.com/settings/installations) (official)

Subscribe `#github-feed` to:
- New issues
- Pull requests (opened, merged, closed)
- Releases
- Stars milestones (100, 500, 1K, 5K, 10K)

Subscribe `#releases` to:
- New releases only

```
/github subscribe TentaCLAW-OS/TentaCLAW issues pulls releases
/github unsubscribe TentaCLAW-OS/TentaCLAW commits comments
```

### 2. Welcome Bot

**Recommended:** Carl-bot or MEE6 (free tier)

On member join:
- Assign `@Community` role
- Send DM with welcome message and link to `#welcome`
- Post in `#general`: "A new tentacle has joined The Tank! Welcome, {user}."

### 3. Moderation Bot

**Recommended:** Carl-bot or Dyno

- Auto-delete spam links
- Rate limit messages (5/10s) in `#general`
- Automod for slurs and harassment
- Warn/mute/ban escalation

### 4. Forum Bot (Optional)

For `#bug-reports` forum template:

```
**TentaCLAW Version:**
**OS:**
**GPU(s):**
**Backend:** (Ollama / vLLM / llama.cpp / BitNet / SGLang / MLX)
**Steps to reproduce:**
1.
2.
3.
**Expected behavior:**
**Actual behavior:**
**Logs:** (paste or attach)
```

---

## Server Settings

| Setting | Value |
|---------|-------|
| Verification level | Medium (must have verified email, registered for 5+ min) |
| Explicit media content filter | Scan messages from all members |
| Default notification settings | Only @mentions |
| System messages channel | `#welcome` |
| Community features | Enabled (if server qualifies) |
| Discovery | Enable once 500+ members |

---

## Launch Day Checklist

- [ ] Server created with all channels
- [ ] Roles configured
- [ ] Welcome message posted in `#welcome`
- [ ] Rules posted in `#rules`
- [ ] GitHub bot connected and subscribed
- [ ] Welcome bot configured
- [ ] Moderation bot active
- [ ] Invite link created: `https://discord.gg/tentaclaw` (permanent, unlimited uses)
- [ ] Link added to GitHub README, website, and all launch posts
- [ ] First message posted in `#announcements` with launch info
- [ ] Team members have `@Team` role
- [ ] Bug report template set in `#bug-reports` forum
- [ ] Feature request template set in `#feature-requests` forum
