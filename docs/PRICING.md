# TentaCLAW OS — Pricing Strategy (Internal)

**Status:** Draft v1.0
**Last updated:** 2026-03-29
**Audience:** Internal team, investors, board

---

## Table of Contents

1. [Pricing Model Overview](#pricing-model-overview)
2. [Tier Rationale](#tier-rationale)
3. [Feature Gating Strategy](#feature-gating-strategy)
4. [Competitor Pricing Comparison](#competitor-pricing-comparison)
5. [Revenue Projections](#revenue-projections)
6. [Upgrade Triggers](#upgrade-triggers)
7. [Pricing Evolution Roadmap](#pricing-evolution-roadmap)

---

## Pricing Model Overview

| Tier | Price | Billing Unit | Target |
|------|-------|-------------|--------|
| **Community** | $0 | — | Individual devs, hobbyists, labs, startups proving concept |
| **Pro** | $29/node/month | Per node, monthly or annual | Teams (5-100 nodes), startups scaling, research orgs |
| **Enterprise** | $99/node/month | Per node, annual contract | Corporations (100+ nodes), regulated industries, government |

**Model:** Open-core. The orchestration engine is AGPLv3 open-source. Pro/Enterprise features ship as a proprietary add-on module.

**Billing unit rationale — per-node, not per-GPU:**
- A node with 8x A100s costs $29/month, not $232. This rewards GPU density.
- Simplifies billing — customers don't need to track GPU counts across heterogeneous hardware.
- Aligns incentives: we want users to run big clusters, not minimize GPU usage.
- Competitive advantage vs. NVIDIA NIM ($4,500/GPU/year = $375/GPU/month).

**Annual discount:** 2 months free (~17% savings) on annual billing.

---

## Tier Rationale

### Community (Free Forever)

**Strategic purpose:** Adoption flywheel. Every open-source GPU project evaluator should be able to install TentaCLAW, run a real workload, and see the value — without hitting paywalls.

**Why these features are free:**
- **Unlimited nodes/GPUs:** Artificial limits kill open-source adoption. GPUStack is free and unlimited. If we cap at 3 nodes, no one evaluates at scale.
- **All 6 backends:** Backend lock-in is the old game. We want users on every backend to be in our ecosystem.
- **CLAWHub marketplace (install):** The marketplace is a network effect engine. More installs = more package authors = more installs.
- **Web dashboard + CLI:** The full operational experience must be available to create advocates.
- **Auto-discovery + self-healing:** This is the core differentiator. Crippling it would undermine the product's identity.
- **Prometheus metrics:** Basic observability is table stakes in 2026.
- **OpenAI/Anthropic API compatibility:** This is how users integrate. Gating APIs would kill adoption.

**What's NOT free:** Anything that only matters when you have a team, compliance needs, or multi-tenant requirements. Individual developers don't need SSO or chargeback.

### Pro ($29/node/month)

**Strategic purpose:** Capture value when Community users bring TentaCLAW into their teams.

**Why $29/node:**
- **Below psychological threshold:** Under $30 is "swipe the credit card" territory for any engineering manager.
- **ROI is obvious:** A single node running Llama 3 70B saves $500-2,000/month vs API pricing. $29 is a rounding error.
- **Scales linearly:** A 20-node cluster = $580/month. That's one engineer's monthly tool budget.
- **Competitive:** Cheaper than any commercial alternative at any scale (see competitor comparison).

**Why these features are gated:**
- **SSO:** Only matters with >5 users. Clear team signal.
- **Namespaces + multi-tenancy:** Only needed when multiple teams share a cluster.
- **Resource quotas + chargeback:** Finance/ops feature, not engineering.
- **Cloud burst:** Requires API key management for RunPod/Lambda — natural paid integration point.
- **Priority email support:** Costs us human time. Must be funded.
- **Fine-tuning orchestration:** Complex feature with high support burden.
- **Custom CLAWHub publishing:** Creating packages is a team/commercial activity.
- **Langfuse integration:** Advanced observability for production workloads.

### Enterprise ($99/node/month)

**Strategic purpose:** Capture maximum value from organizations where GPU infrastructure is mission-critical.

**Why $99/node:**
- **Still radically cheaper than alternatives:** NVIDIA NIM is ~$375/GPU/month (not per-node). A node with 8 GPUs on NVIDIA = $3,000/month vs our $99.
- **Enterprise budget expectations:** $99/node/month for production GPU orchestration is a bargain. Most enterprise infra tools charge 5-10x this.
- **Margin target:** ~85% gross margin at scale (support engineer costs amortized across customer base).

**Why these features are gated:**
- **Dedicated support engineer:** Direct cost center. Must be funded per-account.
- **Custom SLA:** Requires on-call engineering investment.
- **SOC2/HIPAA compliance reports:** Audit and certification costs are real.
- **Federation:** Multi-cluster is architecturally complex and support-intensive.
- **Air-gapped deployment:** Requires separate build/distribution pipeline.
- **Custom integrations:** Engineering services disguised as a feature.
- **On-site training:** Travel + senior engineer time.
- **Volume discounts:** Enterprise lever for deal closing.

---

## Feature Gating Strategy

### Principles

1. **Never cripple core functionality.** The open-source product must be genuinely useful. We compete on team/compliance features, not artificial limits.
2. **Gate on team signals, not scale signals.** We don't limit nodes, GPUs, models, or requests. We gate on features that only matter when organizations adopt.
3. **The upgrade path should feel natural.** When a free user adds a second team member, SSO and namespaces become obviously necessary.
4. **No bait-and-switch.** Features that are free today stay free forever. We may add new Pro features, but never move existing free features behind a paywall.

### Gating Matrix

| Signal | Feature Gated | Tier |
|--------|---------------|------|
| Multiple users | SSO, RBAC | Pro |
| Multiple teams | Namespaces, multi-tenancy | Pro |
| Budget accountability | Resource quotas, chargeback | Pro |
| Burst capacity needs | Cloud burst | Pro |
| Production observability | Langfuse integration | Pro |
| Model customization | Fine-tuning orchestration | Pro |
| Package creation | Custom CLAWHub publishing | Pro |
| Compliance mandates | SOC2/HIPAA reports | Enterprise |
| Multi-datacenter | Federation | Enterprise |
| Security-sensitive | Air-gapped deployment | Enterprise |
| Critical workloads | Custom SLA, dedicated support | Enterprise |

### Technical Implementation

Pro/Enterprise features are delivered via a separate `tentaclaw-pro` module:
- License key validation at cluster level (not per-node)
- Feature flags checked at API gateway layer
- No phone-home telemetry beyond license validation
- Graceful degradation: if license expires, Pro features become read-only (no disruption to inference)

---

## Competitor Pricing Comparison

### Direct Competitors

| Product | Pricing Model | Cost at 10 Nodes (8 GPU each) | Open Source? |
|---------|---------------|-------------------------------|--------------|
| **TentaCLAW Community** | Free | **$0** | Yes (AGPLv3) |
| **TentaCLAW Pro** | $29/node/month | **$290/month** | Open-core |
| **TentaCLAW Enterprise** | $99/node/month | **$990/month** | Open-core |
| **GPUStack** | Free | $0 | Yes (Apache 2.0) |
| **NVIDIA NIM** | ~$4,500/GPU/year | **$300,000/year** ($25,000/month) | No |
| **NVIDIA AI Enterprise** | $4,500/GPU/year (full suite) | **$360,000/year** | No |
| **Red Hat OpenShift AI** | ~$2,500/node/year subscription | **$25,000/year** ($2,083/month) | Source-available |
| **Anyscale (Ray)** | Usage-based, ~$0.05/GPU-hour | **~$29,200/year** ($2,433/month) | Open-core |
| **Run:ai** | ~$250/GPU/month (acquired by NVIDIA) | **~$240,000/year** ($20,000/month) | No |
| **Determined AI (HPE)** | Enterprise license, ~$150/GPU/month | **~$144,000/year** ($12,000/month) | Open-core |

### Key Competitive Takeaways

1. **vs. GPUStack (free):** GPUStack is our only truly free competitor, but lacks: CLAWHub marketplace, 6-backend support, federation, cloud burst, the 111-command CLI. We win on features at the same price (free).

2. **vs. NVIDIA ($4,500/GPU/year):** NVIDIA charges per-GPU, we charge per-node. A single 8-GPU node: NVIDIA = $36,000/year, TentaCLAW Enterprise = $1,188/year. **30x cheaper.** This is our sharpest competitive angle.

3. **vs. Red Hat ($2,500/node/year):** Red Hat charges ~$208/node/month. TentaCLAW Pro is $29/node/month — **7x cheaper**. And they require OpenShift (Kubernetes complexity). We're simpler.

4. **vs. Anyscale/Ray:** Ray is a general compute framework trying to do inference. TentaCLAW is purpose-built for GPU inference orchestration. We're more focused and cheaper.

### Positioning Statement

> "The infrastructure you'd build yourself if you had the time — except it already exists, it's open-source, and the Pro features cost less than a team lunch."

---

## Revenue Projections

### Assumptions

- **Conversion rate (Community to Pro):** 3-5% (industry standard for open-core: GitLab ~3.5%, Grafana ~3%)
- **Pro to Enterprise upsell:** 15-25% of Pro customers
- **Average Pro cluster size:** 12 nodes
- **Average Enterprise cluster size:** 60 nodes
- **Monthly churn (Pro):** 3%
- **Monthly churn (Enterprise):** 1%
- **Annual billing adoption:** 40% (year 1), 60% (year 2+)

### Year 1 Projections (Launch + 12 months)

| Metric | Conservative | Base | Optimistic |
|--------|-------------|------|-----------|
| Community installations | 2,000 | 5,000 | 12,000 |
| Pro conversions (3-5%) | 60 | 200 | 600 |
| Avg Pro nodes/customer | 8 | 12 | 15 |
| Pro MRR | $13,920 | $69,600 | $261,000 |
| Enterprise customers | 3 | 10 | 25 |
| Avg Enterprise nodes | 40 | 60 | 80 |
| Enterprise MRR | $11,880 | $59,400 | $198,000 |
| **Total MRR (Month 12)** | **$25,800** | **$129,000** | **$459,000** |
| **Total ARR (Month 12)** | **$309,600** | **$1,548,000** | **$5,508,000** |

### Year 2 Projections

| Metric | Conservative | Base | Optimistic |
|--------|-------------|------|-----------|
| Community installations | 8,000 | 25,000 | 60,000 |
| Pro customers (cumulative) | 200 | 800 | 2,400 |
| Enterprise customers (cumulative) | 12 | 50 | 120 |
| **Total MRR (Month 24)** | **$78,000** | **$576,000** | **$2,100,000** |
| **Total ARR (Month 24)** | **$936,000** | **$6,912,000** | **$25,200,000** |

### Year 3 Target

| Scenario | ARR Target | Path |
|----------|-----------|------|
| Conservative | $3M ARR | Steady organic growth, niche market |
| Base | $15M ARR | Conference talks, DevRel, word-of-mouth |
| Optimistic | $50M+ ARR | Viral adoption, enterprise land-and-expand |

### Revenue Mix Target (Steady State)

- Pro: 40% of revenue
- Enterprise: 55% of revenue
- Services/Training: 5% of revenue

---

## Upgrade Triggers

### Community -> Pro: What makes free users upgrade

| Trigger | Signal | Timing |
|---------|--------|--------|
| **Second team member joins** | SSO becomes necessary when sharing cluster access | Week 2-4 of team adoption |
| **Department wants their own namespace** | Multi-tenancy needed to isolate teams | Month 1-2 of org adoption |
| **Finance asks "who's using what?"** | Resource quotas + chargeback reporting | Month 2-3 of org adoption |
| **Demand exceeds on-prem capacity** | Cloud burst to RunPod/Lambda needed | Unpredictable, often during product launch |
| **Production incident with no support** | Priority email support has clear value after first outage | After first production issue |
| **Custom model needs fine-tuning** | Fine-tuning orchestration workflow | When off-the-shelf models aren't enough |
| **Publishing internal models to team** | Custom CLAWHub package publishing | When team standardizes on custom models |
| **Production observability gap** | Langfuse integration for tracing, cost tracking | When moving from dev to production |

### Pro -> Enterprise: What makes Pro users upgrade

| Trigger | Signal | Timing |
|---------|--------|--------|
| **Compliance audit** | SOC2/HIPAA reports needed for vendor assessment | External timeline (customer/regulatory requirement) |
| **Multi-datacenter deployment** | Federation needed for geo-distributed inference | Scale growth (usually >50 nodes) |
| **Classified/regulated workloads** | Air-gapped deployment required | Security team mandate |
| **Reliability SLA requirements** | Custom SLA (99.9%+) with financial penalties | When inference becomes customer-facing |
| **Support ticket volume** | Dedicated engineer more efficient than email support | >20 support interactions/month |
| **Scaling past 50 nodes** | Volume discounts make Enterprise cheaper per-node | Natural scale trigger |

### Trigger Automation

Implement in-product nudges (non-intrusive):
- When user attempts a Pro feature: "This feature is available on Pro. Start a 14-day trial?"
- Monthly usage report email: "Your cluster ran 3.2M requests. Teams at your scale typically benefit from [Pro feature]."
- After 30 days of Community: "Ready to bring your team? Pro includes SSO and namespaces."
- Never nag. Maximum 1 upgrade prompt per session. Easy permanent dismiss.

---

## Pricing Evolution Roadmap

### Phase 1: Launch (Now)
- 3-tier pricing as defined above
- Manual Enterprise sales
- Stripe billing for Pro (monthly/annual)
- 14-day Pro trial, no credit card required

### Phase 2: Growth (Month 6-12)
- Usage-based add-ons: cloud burst compute billed pass-through + 10% margin
- CLAWHub marketplace revenue: 20% commission on paid packages
- Annual billing incentives (2 months free)
- Referral program: 1 month free for referrer + referee

### Phase 3: Scale (Month 12-24)
- Consumption-based pricing option (for customers who prefer)
- Managed cloud offering (TentaCLAW Cloud) — hosted control plane
- Training/certification program revenue
- Partner program (MSPs, consultancies)

### Phase 4: Platform (Month 24+)
- Marketplace transaction fees (model authors can sell fine-tuned models)
- Data pipeline add-ons
- Enterprise support tiers (Gold/Platinum)
- Government/FedRAMP pricing tier

---

## Key Decisions & Open Questions

1. **AGPLv3 vs BSL:** AGPLv3 maximizes adoption but means cloud providers could offer TentaCLAW-as-a-service. BSL (like HashiCorp) would prevent this but hurts perception. **Current decision: AGPLv3.** Revisit if cloud providers become a problem.

2. **Per-node vs per-GPU vs per-cluster:** Per-node chosen for simplicity and to reward GPU density. Risk: customers with many small nodes (RPi clusters, edge) pay more per-GPU. Mitigated by volume discounts at Enterprise tier.

3. **Self-serve Enterprise:** Currently Enterprise requires contacting sales. Consider self-serve Enterprise signup at Month 6 if deal velocity supports it.

4. **Free trial length:** 14 days for Pro. Industry standard is 14-30 days. Start at 14, extend if conversion data warrants.

5. **Student/Academic discount:** Offer 50% off Pro for .edu email addresses. Low revenue impact, high adoption and advocacy value.

---

*This document is confidential and for internal use only.*
