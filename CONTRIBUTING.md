# Contributing to TentaCLAW OS

Thank you for considering a contribution to TentaCLAW OS!

## CLAWtopus's Contribution Philosophy

> "Eight arms working together are better than one human working alone."

We welcome contributions of all sizes — from fixing typos to implementing new GPU detection logic.

---

## How to Contribute

### 1. Find Something to Work On

- Look for issues labeled `good-first-issue` or `CLAWtopus-wanted`
- Issues labeled `help-wanted` are high priority
- Feel free to open your own issues for bugs or feature ideas

### 2. Fork and Clone

```bash
# Fork via GitHub UI, then:
git clone https://github.com/YOUR_USERNAME/TentaCLAW-OS.git
cd TentaCLAW-OS
```

### 3. Create a Branch

```bash
git checkout -b feature/my-awesome-feature
# or
git checkout -b fix/that-annoying-bug
```

### 4. Make Your Changes

- Write code that matches the existing style
- Keep commits atomic (one logical change per commit)
- Add comments for complex logic (CLAWtopus appreciates clear code)

### 5. Test

- Test your changes manually if possible
- For ISO builds, run `builder/build-iso.sh` and verify the ISO boots

### 6. Commit and Push

```bash
git add .
git commit -m "Add: my awesome feature
> 
> CLAWtopus says: \"Finally, someone who gets it.\""
git push origin feature/my-awesome-feature
```

### 7. Open a Pull Request

- Fill out the PR template
- Link any related issues
- Be patient — CLAWtopus will review when she has an arm free

---

## Contribution Ideas

### Easy (CLAWtopus-wanted)
- [ ] Improve CLAWtopus ASCII art
- [ ] Add more quotes to the personality system
- [ ] Fix typos in documentation
- [ ] Add more GPU detection patterns

### Medium
- [ ] AMD GPU detection and ROCm support
- [ ] Flight sheet system
- [ ] Web dashboard
- [ ] GPU overclocking profiles

### Hard
- [ ] Multi-node model sharding
- [ ] Dynamic model loading across nodes
- [ ] PXE boot with model streaming
- [ ] Real-time inference load balancing

---

## Coding Style

- Shell scripts: POSIX-compatible, `set -euo pipefail`
- TypeScript: Follow existing patterns, use `snake_case` for shell vars, `camelCase` for TS
- Colors: Use the brand palette (cyan #00FFFF, purple #8C00C8, teal #008C8C)

---

## Questions?

Open an issue or join the Discord. CLAWtopus is usually around.

---

> *"Together, we're gonna run so many local models."* — CLAWtopus
