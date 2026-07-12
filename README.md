# Browser LLM Demo

Minimal browser-only animal guessing demo built with a remote WebLLM model and plain HTML.

- No backend
- No API key
- No build system
- Uses WebGPU in the browser

The page loads a remote prebuilt model, asks the user yes/no animal questions, and saves the learned question tree in `localStorage`.

Run it from this exact folder:

```bash
cd C:\work-poc\portfolio\local-llm-browser
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Learning goals

This project is intended to grow into a study project for:

- modern JavaScript that current browsers support without bundling;
- system design;
- design patterns.

It will also include a few educational classes that demonstrate practical architecture choices, code organization, and modern browser-native JavaScript techniques.
