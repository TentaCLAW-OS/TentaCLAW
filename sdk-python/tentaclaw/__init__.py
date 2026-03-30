"""
TentaCLAW Python SDK
====================

Manage your GPU inference cluster from Python.

    from tentaclaw import TentaCLAW

    tc = TentaCLAW("http://localhost:8080")

    # Cluster status
    summary = tc.cluster.summary()
    print(f"Nodes: {summary['online_nodes']}, GPUs: {summary['total_gpus']}")

    # Chat with a model
    response = tc.chat("llama3.1:8b", "Hello!")
    print(response.content)

    # Deploy a model
    tc.models.deploy("deepseek-r1:70b")

    # Stream inference
    for chunk in tc.chat("llama3.1:8b", "Tell me a story", stream=True):
        print(chunk, end="", flush=True)

CLAWtopus says: "Python devs, welcome to the family."
"""

__version__ = "0.1.0"

import requests
import json
from typing import Optional, List, Dict, Any, Generator, Union


class TentaCLAWError(Exception):
    """Base exception for TentaCLAW SDK errors."""
    def __init__(self, status_code: int, message: str, path: str):
        self.status_code = status_code
        self.message = message
        self.path = path
        super().__init__(f"TentaCLAW API error {status_code} on {path}: {message}")


class ChatResponse:
    """Wrapper for chat completion responses."""
    def __init__(self, data: dict):
        self._data = data
        choice = data.get("choices", [{}])[0]
        self.content = choice.get("message", {}).get("content", "")
        self.role = choice.get("message", {}).get("role", "assistant")
        self.finish_reason = choice.get("finish_reason")
        self.usage = data.get("usage", {})
        self.model = data.get("model", "")
        self._tentaclaw = data.get("_tentaclaw", {})

    def __str__(self):
        return self.content

    def __repr__(self):
        return f"ChatResponse(model={self.model!r}, content={self.content[:50]!r}...)"


class _HttpClient:
    def __init__(self, base_url: str, api_key: Optional[str] = None, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "User-Agent": f"TentaCLAW-Python-SDK/{__version__}",
        })
        if api_key:
            self.session.headers["Authorization"] = f"Bearer {api_key}"
        self.timeout = timeout

    def get(self, path: str, params: Optional[dict] = None) -> Any:
        res = self.session.get(f"{self.base_url}{path}", params=params, timeout=self.timeout)
        if not res.ok:
            raise TentaCLAWError(res.status_code, res.text, path)
        return res.json()

    def post(self, path: str, json_data: Optional[dict] = None) -> Any:
        res = self.session.post(f"{self.base_url}{path}", json=json_data, timeout=self.timeout)
        if not res.ok:
            raise TentaCLAWError(res.status_code, res.text, path)
        return res.json()

    def post_stream(self, path: str, json_data: dict) -> Generator[str, None, None]:
        res = self.session.post(f"{self.base_url}{path}", json=json_data, stream=True, timeout=self.timeout)
        if not res.ok:
            raise TentaCLAWError(res.status_code, res.text, path)
        for line in res.iter_lines():
            if line:
                line = line.decode("utf-8")
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        return
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if "content" in delta:
                        yield delta["content"]

    def delete(self, path: str) -> Any:
        res = self.session.delete(f"{self.base_url}{path}", timeout=self.timeout)
        if not res.ok:
            raise TentaCLAWError(res.status_code, res.text, path)
        return res.json()

    def put(self, path: str, json_data: Optional[dict] = None) -> Any:
        res = self.session.put(f"{self.base_url}{path}", json=json_data, timeout=self.timeout)
        if not res.ok:
            raise TentaCLAWError(res.status_code, res.text, path)
        return res.json()


class NodesClient:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self) -> List[dict]:
        return self._http.get("/api/v1/nodes")

    def get(self, node_id: str) -> dict:
        return self._http.get(f"/api/v1/nodes/{node_id}")

    def register(self, node_id: str, farm_hash: str, hostname: str, gpu_count: int = 0) -> dict:
        return self._http.post("/api/v1/register", {"node_id": node_id, "farm_hash": farm_hash, "hostname": hostname, "gpu_count": gpu_count})

    def delete(self, node_id: str) -> dict:
        return self._http.delete(f"/api/v1/nodes/{node_id}")

    def tags(self, node_id: str) -> List[str]:
        return self._http.get(f"/api/v1/nodes/{node_id}/tags")

    def add_tag(self, node_id: str, tag: str) -> dict:
        return self._http.post(f"/api/v1/nodes/{node_id}/tags", {"tags": [tag]})


class ModelsClient:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self) -> dict:
        return self._http.get("/api/v1/models")

    def deploy(self, model: str, node_id: Optional[str] = None) -> dict:
        body = {"model": model}
        if node_id:
            body["node_id"] = node_id
        return self._http.post("/api/v1/deploy", body)

    def search(self, query: str) -> list:
        return self._http.get("/api/v1/model-search", {"q": query})

    def recommend(self, vram_mb: Optional[int] = None) -> list:
        params = {"vram_mb": vram_mb} if vram_mb else None
        return self._http.get("/api/v1/models/recommend", params)

    def estimate_vram(self, model: str, quantization: str = "Q4_K_M") -> dict:
        return self._http.get("/api/v1/models/estimate-vram", {"model": model, "quantization": quantization})


class ClusterClient:
    def __init__(self, http: _HttpClient):
        self._http = http

    def summary(self) -> dict:
        return self._http.get("/api/v1/summary")

    def health(self) -> dict:
        return self._http.get("/api/v1/health/score")

    def health_detailed(self) -> dict:
        return self._http.get("/api/v1/health/detailed")

    def capacity(self) -> dict:
        return self._http.get("/api/v1/capacity")

    def power(self) -> dict:
        return self._http.get("/api/v1/power")

    def export_config(self) -> dict:
        return self._http.get("/api/v1/export")


class AlertsClient:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self) -> list:
        return self._http.get("/api/v1/alerts")

    def rules(self) -> list:
        return self._http.get("/api/v1/alert-rules")

    def create_rule(self, name: str, metric: str, operator: str, threshold: float, severity: str = "warning") -> dict:
        return self._http.post("/api/v1/alert-rules", {"name": name, "metric": metric, "operator": operator, "threshold": threshold, "severity": severity})


class TentaCLAW:
    """Main TentaCLAW client."""

    def __init__(self, gateway_url: str = "http://localhost:8080", api_key: Optional[str] = None, timeout: int = 30):
        self._http = _HttpClient(gateway_url, api_key, timeout)
        self.nodes = NodesClient(self._http)
        self.models = ModelsClient(self._http)
        self.cluster = ClusterClient(self._http)
        self.alerts = AlertsClient(self._http)

    def ping(self) -> bool:
        try:
            self._http.get("/health")
            return True
        except:
            return False

    def version(self) -> dict:
        return self._http.get("/api/v1/version")

    def chat(self, model: str, message: str, system_prompt: Optional[str] = None,
             temperature: float = 0.7, max_tokens: int = 4096, stream: bool = False) -> Union[ChatResponse, Generator[str, None, None]]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": message})

        body = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": stream}

        if stream:
            return self._http.post_stream("/v1/chat/completions", body)
        else:
            data = self._http.post("/v1/chat/completions", body)
            return ChatResponse(data)

    def embed(self, model: str, input: Union[str, List[str]]) -> dict:
        return self._http.post("/v1/embeddings", {"model": model, "input": input})
