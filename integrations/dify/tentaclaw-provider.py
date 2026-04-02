"""
TentaCLAW Model Provider for Dify
Drop this into your Dify installation's model_providers/ directory.

Usage:
1. Copy this directory to dify/api/core/model_runtime/model_providers/tentaclaw/
2. Set TENTACLAW_GATEWAY_URL in Dify's .env
3. TentaCLAW appears as a model provider in Dify settings

TentaCLAW says: "Dify builds the workflows. I provide the muscle."
"""

import os
import json
import requests
from typing import Generator, List, Optional

GATEWAY_URL = os.environ.get('TENTACLAW_GATEWAY_URL', 'http://localhost:8080')
API_KEY = os.environ.get('TENTACLAW_API_KEY', '')


class TentaCLAWProvider:
    """TentaCLAW as a Dify model provider."""

    def validate_provider_credentials(self, credentials: dict) -> None:
        """Validate that TentaCLAW gateway is reachable."""
        url = credentials.get('gateway_url', GATEWAY_URL)
        response = requests.get(f"{url}/health", timeout=5)
        if response.status_code != 200:
            raise Exception(f"TentaCLAW gateway not reachable at {url}")

    def get_models(self, credentials: dict) -> List[dict]:
        """Return available models from TentaCLAW cluster."""
        url = credentials.get('gateway_url', GATEWAY_URL)
        headers = {}
        if credentials.get('api_key'):
            headers['Authorization'] = f"Bearer {credentials['api_key']}"

        response = requests.get(f"{url}/v1/models", headers=headers, timeout=10)
        data = response.json()

        models = []
        for model in data.get('data', []):
            models.append({
                'model': model['id'],
                'model_type': 'llm',
                'model_properties': {
                    'context_size': 8192,
                    'mode': 'chat',
                },
            })
        return models


class TentaCLAWLargeLanguageModel:
    """TentaCLAW LLM implementation for Dify."""

    def invoke(self, model: str, credentials: dict,
               prompt_messages: list, model_parameters: dict,
               stream: bool = False) -> Generator:
        """Run inference via TentaCLAW gateway."""
        url = credentials.get('gateway_url', GATEWAY_URL)
        headers = {'Content-Type': 'application/json'}
        if credentials.get('api_key'):
            headers['Authorization'] = f"Bearer {credentials['api_key']}"

        # Convert Dify messages to OpenAI format
        messages = []
        for msg in prompt_messages:
            messages.append({
                'role': msg.role.value if hasattr(msg.role, 'value') else msg.role,
                'content': msg.content,
            })

        body = {
            'model': model,
            'messages': messages,
            'stream': stream,
            'temperature': model_parameters.get('temperature', 0.7),
            'max_tokens': model_parameters.get('max_tokens', 4096),
        }

        if stream:
            return self._stream_invoke(url, headers, body)
        else:
            return self._sync_invoke(url, headers, body)

    def _sync_invoke(self, url, headers, body):
        response = requests.post(f"{url}/v1/chat/completions",
                                 headers=headers, json=body, timeout=120)
        data = response.json()
        # Convert to Dify response format
        yield {
            'text': data['choices'][0]['message']['content'],
            'usage': data.get('usage', {}),
        }

    def _stream_invoke(self, url, headers, body):
        response = requests.post(f"{url}/v1/chat/completions",
                                 headers=headers, json=body, stream=True, timeout=120)
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data = line[6:]
                    if data == '[DONE]':
                        return
                    chunk = json.loads(data)
                    delta = chunk.get('choices', [{}])[0].get('delta', {})
                    if 'content' in delta:
                        yield {'text': delta['content']}
