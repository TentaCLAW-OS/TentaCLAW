# TentaCLAW Home Assistant Integration

Use your TentaCLAW GPU cluster as an AI conversation agent and sensor platform in Home Assistant.

## Features

- **Conversation Agent** — Talk to your cluster models from HA voice pipelines
- **AI Task Provider** — Use cluster inference for text generation, summarization
- **GPU Sensors** — Temperature, VRAM usage, utilization per GPU
- **Cluster Health** — Binary sensor for cluster status
- **Power Monitoring** — Total cluster power consumption as an energy sensor

## Installation

### Via HACS (Recommended)
1. Add this repository to HACS as a custom repository
2. Install "TentaCLAW OS"
3. Restart Home Assistant
4. Add integration via Settings → Devices & Services → Add Integration → TentaCLAW

### Manual
1. Copy `custom_components/tentaclaw/` to your HA config directory
2. Restart Home Assistant
3. Add integration via Settings → Devices & Services

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| Gateway URL | http://localhost:8080 | TentaCLAW gateway address |
| API Key | — | Optional API key |
| Scan Interval | 30 | Seconds between sensor updates |

## Entities Created

| Entity | Type | Description |
|--------|------|-------------|
| `sensor.tentaclaw_cluster_health` | Sensor | Health score 0-100 |
| `sensor.tentaclaw_total_gpus` | Sensor | Total GPU count |
| `sensor.tentaclaw_total_vram` | Sensor | Total VRAM in GB |
| `sensor.tentaclaw_power_watts` | Sensor | Cluster power draw |
| `sensor.tentaclaw_gpu_*_temp` | Sensor | Per-GPU temperature |
| `sensor.tentaclaw_gpu_*_vram` | Sensor | Per-GPU VRAM usage |
| `binary_sensor.tentaclaw_online` | Binary | Cluster online/offline |
| `conversation.tentaclaw` | Conversation | AI conversation agent |

## Automation Examples

```yaml
# Alert when GPU temperature exceeds 85°C
automation:
  - trigger:
      platform: numeric_state
      entity_id: sensor.tentaclaw_gpu_0_temp
      above: 85
    action:
      service: notify.mobile_app
      data:
        message: "GPU 0 is at {{ states('sensor.tentaclaw_gpu_0_temp') }}°C!"

# Ask TentaCLAW to summarize your day
automation:
  - trigger:
      platform: time
      at: "22:00"
    action:
      service: conversation.process
      data:
        agent_id: conversation.tentaclaw
        text: "Summarize the key events from my smart home today"
```

---

*TentaCLAW says: "Your smart home just got smarter. Eight arms for every room."*
