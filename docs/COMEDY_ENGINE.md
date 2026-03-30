# TentaCLAW Comedy Engine

Design document for the TentaCLAW comedy engine -- a brand-safe humor generator for CLI wait states, dashboard loading screens, and personality-driven UX.

## Overview

TentaCLAW includes a comedy engine that generates humorous wait-state messages without copying existing material. The key principles:
- Do not scrape comedians from YouTube
- Do not train on or reuse stand-up transcripts as direct generation material unless you clearly have rights
- Do build a local mechanics engine that learns structure, not bits

That means the engine should study comedy as:
- setup
- expectation
- misdirection
- reversal
- escalation
- specificity
- persona contrast
- deadpan framing

It should not study comedy as:
- reusable punchlines
- impersonation of living comics
- transcript remixing
- quote laundering

## Why Not YouTube Scraping

### Official constraints

As of the YouTube Terms of Service dated December 15, 2023, YouTube says users are not allowed to:
- access the service using automated means such as robots, botnets, or scrapers, except public search engines per robots.txt or with prior written permission
- access, reproduce, download, alter, or otherwise use content except as authorized by the service or with prior written permission from YouTube and the rights holders

Official source:
- https://www.youtube.com/t/terms

### Captions are not a loophole

The official YouTube Data API caption download method requires OAuth authorization and is meant for caption tracks tied to videos the authorized user can manage. That is not a general-purpose public transcript harvesting API for comedians.

Official sources:
- https://developers.google.com/youtube/v3/docs/captions
- https://developers.google.com/youtube/v3/docs/captions/download
- https://developers.google.com/youtube/terms/developer-policies-guide

### Practical conclusion

If you want this project to stay clean, stable, and shippable, the source acquisition path should be:
- hand-authored internal material
- public-domain humor texts
- licensed corpora
- user-supplied local transcripts with explicit permission
- abstracted mechanics extracted from those sources, not reusable wording

## What Humor Research Actually Suggests

### 1. Incongruity and resolution

A large part of humor works by creating an expectation and then violating it in a way the audience can reinterpret.

Primary source review:
- https://pmc.ncbi.nlm.nih.gov/articles/PMC9526306/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC5402715/

Implication for wait messages:
- line 1 establishes a plain system action
- line 2 adds a small twist or reinterpretation

Example:
- `Verifying model integrity...`
- `Professional paranoia is part of the service.`

### 2. Setup and punchline can be modeled mechanically

ACL work on humor recognition modeled humor as setup uncertainty followed by punchline surprisal. That is useful here because a wait message can be generated from the same structure without copying anyone's wording.

Primary source:
- https://aclanthology.org/2021.acl-short.6

Implication:
- the engine should explicitly track a straight setup plus a short surprise beat
- that is better than asking a model to "be funny"

### 3. Benign violation matters

Humor tends to land when something is off, but not threatening. For product wait states, this means the comedy should feel mildly absurd, not dangerous.

Useful research context:
- https://pmc.ncbi.nlm.nih.gov/articles/PMC9893297/

Implication:
- avoid drowning, madness, doom, and catastrophe in routine loading copy
- use deadpan, pseudo-diagnostics, and tiny reversals instead

## What The Engine Should Learn

The engine should learn mechanics tags, not comedian style.

Recommended mechanics taxonomy:
- `deadpan`: say something absurd in a calm operational tone
- `misdirection`: begin technical, end slightly sideways
- `literalization`: turn sea-creature metaphors into fake physical procedure
- `tiny_reversal`: flip the last phrase without changing meaning too much
- `escalation`: make the task sound grander than it is
- `overqualified_diagnostic`: pretend the absurdity is a normal metric
- `faux_epic`: mythic language wrapped around a mundane operation
- `direct_recovery`: no joke, just honest recovery guidance

## Source Strategy That Does Not Steal Jokes

### Allowed pipeline

1. Gather approved local source texts.
2. Chunk them into short passages.
3. Ask a local model to output only abstractions:
   - setup summary
   - punchline move
   - mechanism label
   - taboo or unsafe elements
   - reusability risk
4. Discard the original wording from the runtime generation path.
5. Keep only the mechanic record and optional factual theme.
6. Generate fresh copy from mechanics plus TentaCLAW brand context.
7. Filter near-duplicates before display.

### Not allowed pipeline

1. scrape a comedian's channel
2. download captions
3. embed the transcript
4. retrieve similar jokes
5. paraphrase them into the product

That is exactly the kind of system that drifts into joke theft.

## Recommended Models for Generation

For comedy engine generation, 8B-class models are sufficient:
- Any instruction-tuned 8B model (e.g., Llama 3.1 8B, Qwen 8B, Hermes 8B)
- An embedding model for near-duplicate screening (e.g., `nomic-embed-text`)

Why:
- 8B-class models are sufficient for short controlled microcopy
- They are fast for repeated wait-state generation
- Embedding models enable originality checks against prior outputs

## Runtime Architecture

### Phase 1: Template-plus-mechanics engine

This is the safest first release and is now implemented in the gateway.

Behavior:
- always tells the truth about the current system state
- chooses a humor mechanic by wait-state type
- rotates cephalopod facts and myth notes
- blocks obvious famous phrases
- avoids repeating near-identical lines back-to-back
- can optionally ask local Ollama to generate a fresher version

### Phase 2: Mechanics extraction agent

Build a separate local job that consumes approved text files and outputs records like:

```json
{
  "setup": "Routine technical action framed plainly",
  "twist": "Unexpectedly formal absurdity",
  "mechanic": "overqualified_diagnostic",
  "tone": "deadpan",
  "risk": "low",
  "reuse_text": false
}
```

The runtime engine should use those mechanic records, not source text retrieval.

### Phase 3: Originality scoring

For stronger protections, add:
- lexical n-gram overlap checks
- embedding similarity checks against source corpus and recent outputs
- denylist for famous phrases and meme formats
- style constraints that ban named-comedian imitation

## Safety Rules For The Engine

1. Status first, joke second.
2. If the state is error, recovery beats comedy.
3. Never mention or imitate specific comedians.
4. Never quote famous lines.
5. Never use source transcripts at runtime.
6. Prefer science, mythology, and fake diagnostics over generic startup banter.
7. Keep the line short enough to survive repetition.

## Implementation Status

### Implemented

- `gateway/src/comedy.ts`
  A local comedy engine that produces wait-state copy from mechanics-aware templates and can optionally use Ollama for generation.

- `gateway/tests/comedy.test.ts`
  Unit tests for state normalization, originality filters, and fallback generation.

- Gateway endpoint design
  The engine is suitable for `/api/v1/comedy/wait-line` and UI callers.

### Not Implemented

- YouTube ingestion
- transcript scraping
- comedian style cloning
- vector-based originality checks
- long-form corpus analysis agent

Those should remain out of scope until the source pipeline is rights-clean.

## Next Steps

1. Add a local corpus directory for approved text only.
2. Build a mechanics-extraction job that stores abstractions instead of text.
3. Add embedding-based similarity checks using an embedding model.
4. Connect the comedy endpoint to the dashboard wait surfaces and CLI joke command.
5. Add telemetry so weak lines can be retired.

## Product Fit

This project already has a mascot, a mythology system, and a wait-heavy environment. That makes it unusually well-suited for a comedy engine.

The winning version is not a joke scraper.
The winning version is a brand-safe mechanical humor generator with a local model, a clean corpus policy, and hard originality checks.
