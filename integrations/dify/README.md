# TentaCLAW Model Provider for Dify

Use your TentaCLAW GPU cluster as a model provider in [Dify](https://dify.ai). Your models, your hardware, zero per-token fees.

## Prerequisites

- A running TentaCLAW OS cluster with the API gateway accessible
- A Dify installation (self-hosted or local development)

## Installation

1. **Copy the provider into Dify's model providers directory:**

   ```bash
   cp -r integrations/dify/ \
     <dify-root>/api/core/model_runtime/model_providers/tentaclaw/
   ```

   Rename `tentaclaw-provider.py` to `tentaclaw.py` (or adjust imports to match Dify's expected module name for your version).

2. **Set environment variables in Dify's `.env`:**

   ```env
   TENTACLAW_GATEWAY_URL=http://your-gateway-host:8080
   TENTACLAW_API_KEY=your-api-key-if-needed
   ```

3. **Restart Dify.**

4. **Configure the provider in Dify's UI:**
   - Go to **Settings > Model Providers**
   - Find **TentaCLAW OS** in the provider list
   - Enter your gateway URL and (optionally) an API key
   - Click **Save** -- Dify will validate the connection

## How It Works

The provider communicates with TentaCLAW's API gateway using the OpenAI-compatible `/v1/chat/completions` endpoint. This means any model served by your TentaCLAW cluster (llama.cpp, vLLM, TGI, etc.) is automatically available in Dify.

### Endpoints Used

| Endpoint                  | Purpose                              |
|---------------------------|--------------------------------------|
| `GET /health`             | Validate provider credentials        |
| `GET /v1/models`          | List available models                |
| `POST /v1/chat/completions` | Run inference (sync and streaming) |

### Streaming

The provider supports SSE streaming. When Dify requests a streaming response, the provider reads the `data:` lines from TentaCLAW's SSE stream and yields content deltas back to Dify in real time.

## Files

| File                     | Description                                |
|--------------------------|--------------------------------------------|
| `tentaclaw-provider.py`  | Provider and LLM classes                   |
| `provider.yaml`          | Dify provider manifest (labels, schema)    |
| `README.md`              | This file                                  |

## Icons

Dify expects `icon_s.svg` and `icon_l.svg` in the provider directory. Add your TentaCLAW logo SVGs before deploying. The `provider.yaml` references these filenames.

## Troubleshooting

- **"TentaCLAW gateway not reachable"** -- Verify the gateway URL is correct and the cluster is running. Test with `curl http://your-gateway:8080/health`.
- **No models listed** -- Ensure at least one model is loaded on the cluster. Check with `curl http://your-gateway:8080/v1/models`.
- **Timeouts** -- The default inference timeout is 120 seconds. For very large models or long generations, you may need to increase this in the provider code.
- **Authentication errors** -- If your gateway requires an API key, make sure it is set both in Dify's environment and in the provider configuration UI.
