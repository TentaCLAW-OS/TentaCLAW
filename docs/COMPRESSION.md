# Model Compression

Squeeze more performance from less VRAM. Auto-quantize any model.

## Auto-Quantization

```bash
# Upload a model and get every quantization variant
clawtopus compress llama3.1:8b --targets Q4_K_M,Q5_K_M,Q8_0,AWQ

# Or let CLAWtopus choose the best for your VRAM
clawtopus compress llama3.1:8b --auto --vram 16384
```

## Quantization Comparison

```bash
clawtopus compress compare llama3.1:8b

  QUANTIZATION COMPARISON — llama3.1:8b on RTX 4090

  Quant    Size    VRAM    Quality   Tok/s   Recommended
  Q2_K     2.5GB   3.5GB   78%       85      ✗ Quality too low
  Q3_K_M   3.2GB   4.2GB   85%       72      ✗ Below threshold
  Q4_K_M   4.5GB   5.5GB   93%       62      ✓ Best balance
  Q5_K_M   5.4GB   6.4GB   96%       55      ✓ High quality
  Q6_K     6.3GB   7.3GB   98%       48      ✓ Near-lossless
  Q8_0     8.0GB   9.0GB   99%       42      ✓ Premium
  FP16     16GB    17GB    100%      35      ✗ Too large
```

## Smart Recommendation

TentaCLAW considers YOUR hardware:
- Available VRAM → filters options that fit
- Model type → code models need higher quality
- Workload → chat can tolerate Q4, analysis needs Q6+
- FP8 auto-detection → H100/H200 get FP8 (lossless 2x speed)

## Supported Formats

| Format | Tool | Best For |
|--------|------|----------|
| GGUF (Q2-Q8) | llama.cpp | Ollama, CPU+GPU |
| AWQ | AutoAWQ | vLLM, GPU-optimized |
| GPTQ | AutoGPTQ | vLLM, GPU-optimized |
| FP8 | vLLM native | H100/H200 (near-lossless) |
| EXL2 | ExLlamaV2 | Maximum GPU speed |

---

*CLAWtopus says: "Q4_K_M is 93% as good at 28% the size. Math doesn't lie."*
