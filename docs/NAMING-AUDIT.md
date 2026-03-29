# TentaCLAW OS Naming Audit

## Canonical Naming Recommendation

### Product
**TentaCLAW OS**

### Mascot
**CLAWtopus**

### Category line
**AI inference cluster OS**

### Short product shorthand
**TentaCLAW** only in casual copy, not as the primary formal name.

## Current Good Patterns
- README hero uses **TentaCLAW OS**
- Launch docs consistently use **AI inference cluster OS**
- CLAWtopus is clearly framed as mascot/personality in new launch docs

## Current Problems Found

### 1. Repo link mismatch in launch-facing docs
README currently links ISO download from:
- `https://github.com/TentaCLAW-OS/TentaCLAW/releases/...`

But other docs point to:
- `https://github.com/TentaCLAW-OS/TentaCLAW-OS`

**Action:** choose one canonical org/repo path and update every launch-facing reference to match.

### 2. Website casing varies
Current references include:
- `www.TentaCLAW.io`
- `TentaCLAW.io`
- `tentaclaw.io`
- `tentaclaw.os` in older content ideas

**Action:** pick one public canonical URL format for launch assets.
Recommendation: use lowercase in plain-text copy for readability, even if branding art preserves stylization.

### 3. CLI naming history may confuse people
There are references to:
- `CLAWtopus CLI`
- `CLAWDIA rebranded`
- `tentaclaw`
- `clawtopus`
- `tentaclawctl` in older idea docs

**Action:** for launch, clearly state:
- Product = TentaCLAW OS
- Mascot = CLAWtopus
- CLI binary = `clawtopus`

### 4. Legacy / brainstorm docs contain inconsistent launch language
There are many older branding and social docs with mixed repo names, URLs, and speculative naming.

**Action:** do not use older brainstorm docs as launch-source-of-truth.
Source of truth should be:
- `README.md`
- `docs/LAUNCH.md`
- `docs/RELEASE.md`
- `docs/SOCIAL.md`
- `docs/HN-FINAL.md`

## Launch-Day Naming Rules
- Always write **TentaCLAW OS** in headlines
- Use **CLAWtopus** only after explaining the product
- Prefer **AI inference cluster OS** as the category line
- Use one repo URL everywhere
- Use one website URL everywhere
- Do not mix old CLI names into launch copy

## Immediate Fixes Recommended
- [ ] Fix README ISO download repo path
- [ ] Confirm canonical GitHub org/repo path
- [ ] Confirm canonical website URL format
- [ ] Confirm Discord invite URL
- [ ] Update Quick Start if repo path changes

## Bottom Line
The brand itself is memorable.
The risk is not weak branding — it’s inconsistent naming at the exact moment people are trying to copy links and tell friends what they just saw.
