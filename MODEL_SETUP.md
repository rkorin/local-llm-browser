# Model Source

This version does not use a local `models/` folder.

It loads a remote prebuilt WebLLM model directly from:

- model repo: `https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC`
- wasm library: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm`

The constants live at the top of [index.html](./index.html).

## Run

Run the server from this exact folder:

```bash
cd C:\work-poc\portfolio\local-llm-browser
python -m http.server 8080
```

Open:

```text
http://localhost:8080
```

Do not open the file with `file://`.

## Note

If later you want a fully local version, WebLLM expects compiled MLC artifacts, not a single base model file or a base64 blob.
