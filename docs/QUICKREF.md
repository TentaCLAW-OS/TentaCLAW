# TentaCLAW OS Quick Reference Card

## Essential Commands

| Command | Description |
|---------|-------------|
| `make iso` | Build the ISO image |
| `make pxe` | Build PXE artifacts |
| `make agent` | Build the agent only |
| `make test` | Run build tests |
| `make help` | Show all targets |

## Agent Commands (on node)

| Command | Description |
|---------|-------------|
| `systemctl start tentaclaw-agent` | Start agent |
| `systemctl stop tentaclaw-agent` | Stop agent |
| `systemctl restart tentaclaw-agent` | Restart agent |
| `tentaclaw-agent --help` | Agent help |

## TentaCLAW Shell Commands

| Command | Description |
|---------|-------------|
| `status` | Show cluster status |
| `gpu` | Show GPU info |
| `models` | List deployed models |
| `nodes` | List cluster nodes |
| `bench` | Run benchmark |
| `init` | Run setup wizard |
| `logs` | Show agent logs |
| `help` | Show help |
| `ascii [style]` | Show ASCII art |
| `joke` | Hear a terrible pun |
| `fortune` | Get wisdom |
| `exit` | Exit shell |

## ASCII Art Styles

```
happy, sleepy, evil, thinking, party
coding, mining, hacker, love, fire
matrix, space, logo
```

## Gateway API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/nodes/register` | Register node |
| POST | `/api/v1/nodes/:id/stats` | Push stats |
| GET | `/api/v1/nodes/:id/commands` | Get commands |
| GET | `/api/v1/nodes/:id/config` | Get config |
| GET | `/api/v1/nodes` | List nodes |
| POST | `/api/v1/nodes/:id/commands` | Push command |
| DELETE | `/api/v1/nodes/:id` | Remove node |

## Gateway Legacy Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/status` | Full status |
| GET | `/api/routes` | List routes |
| POST | `/api/route` | Add route |
| POST | `/api/deploy` | Deploy model |
| POST | `/api/stream/:requestId` | Stream request |

## Key Files

| Path | Description |
|------|-------------|
| `/etc/tentaclaw/agent.conf` | Agent config |
| `/etc/tentaclaw/gateway.conf` | Gateway config |
| `/etc/hive-config/` | Hive-style config |
| `/var/log/tentaclaw/` | Logs |
| `/usr/share/clawtopus/` | CLAWtopus assets |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TENTACLAW_DEBUG` | 0 | Debug mode |
| `TENTACLAW_GATEWAY_URL` | - | Gateway URL |
| `TENTACLAW_NODE_ID` | - | Node ID |
| `TENTACLAW_FARM_HASH` | - | Farm hash |
| `TENTACLAW_SHOW_ALL` | 0 | Show hidden nodes |
| `TENTACLAW_ASCII_MODE` | 0 | ASCII mode |

## Kernel Boot Params

| Param | Description |
|-------|-------------|
| `tentaclaw.meme=on` | Meme mode |
| `tentaclaw.verbose=MAX` | Max verbosity |
| `tentaclaw.colors=RAINBOW` | Rainbow mode |

## Ports

| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | Gateway HTTP |
| 443 | Gateway HTTPS |
| 3000 | Dev server |

## Colors

```
Primary:   Cyan    #00FFFF
Secondary: Purple  #8C00C8
Tertiary:  Teal    #008C8C
Text:      White   #F0F0F0
```

---

*"Eight arms, eight GPUs, infinite possibilities."* 🐙
