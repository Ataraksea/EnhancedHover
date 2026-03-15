## Enhanced Hover

Enhanced Hover is a VS Code extension that adds AI-assisted code hovers and a symbol details sidebar for TypeScript, JavaScript, and Python.

It combines local editor context with the VS Code language model API to explain symbols, show their definition, and surface real usage examples from the workspace.

![](media/preview.gif)

### Features

- Hover summaries for supported languages.
- A right-click command to open symbol details directly.
- A sidebar panel with dense symbol explanations, definition code, and usage snippets.
- Background summary prefetch after hover dwell.
- Configurable model selection through the VS Code language model API.
- Built-in diagnostics command for troubleshooting editor/model integration issues.

### Currently Supported Languages

- TypeScript
- JavaScript
- Python

### Requirements

- VS Code `^1.100.0`
- Access to a compatible model through the VS Code language model API
- GitHub Copilot or another supported provider configured in VS Code, depending on the selected model vendor

### Usage

1. Open a supported source file.
2. Hover a symbol to see the short explanation.
3. Click `Read more`, or right-click and choose `Enhanced Hover: Open Symbol Details`.
4. Run `Enhanced Hover: Initialize AI Access` once if you want model-generated explanations.

If AI access is unavailable, the extension falls back to local symbol analysis so the sidebar still shows useful information.

### Commands

- `Enhanced Hover: Initialize AI Access`
- `Enhanced Hover: Open Symbol Details`
- `Enhanced Hover: Refresh Current Symbol`
- `Enhanced Hover: Run Diagnostics`

### Settings

- `enhancedHover.prefetchEnabled`
- `enhancedHover.hoverDwellMs`
- `enhancedHover.cacheTtlMs`
- `enhancedHover.maxContextLines`
- `enhancedHover.requestTimeoutMs`
- `enhancedHover.model.vendor`
- `enhancedHover.model.family`
- `enhancedHover.model.id`
- `enhancedHover.model.version`

### Development

```bash
npm install
npm run compile
npm run lint
npm test
```

Launch the extension with `F5` in VS Code to open an Extension Development Host.

### Integration Tests

```bash
npm run test:integration
```

This downloads a VS Code test build into `.vscode-test/`, launches the extension in an isolated host, and runs end-to-end integration tests against `test-fixtures/`.

### Notes

- This extension uses the VS Code language model API. It does not require direct third-party API keys in the extension itself.
- The `Run Diagnostics` command is intended for troubleshooting model access, symbol resolution, and sidebar rendering.

### License

MIT. See `LICENSE.md`.