import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDetailPrompt, buildSummaryPrompt } from '../ai/promptBuilder';
import type { SymbolContext } from '../types';

const baseContext: SymbolContext = {
  key: 'symbol::1',
  symbolName: 'type',
  symbolKind: 'Function',
  containerName: 'input.ts',
  languageId: 'typescript',
  sourceUri: { fsPath: 'd:/EnhancedHover/src/tools/input.ts' } as SymbolContext['sourceUri'],
  wordRange: {} as SymbolContext['wordRange'],
  hoverTexts: ['Types text input automation tool'],
  references: [],
  definitionSnippet: {
    uri: { fsPath: 'd:/EnhancedHover/src/tools/input.ts' } as SymbolContext['sourceUri'],
    languageId: 'typescript',
    range: {} as SymbolContext['wordRange'],
    startLine: 320,
    code: 'export const type = definePageTool({ name: "type" });'
  }
};

test('buildSummaryPrompt constrains hover output', () => {
  const prompt = buildSummaryPrompt(baseContext);
  assert.match(prompt.instruction, /Return exactly 3 bullet lines/i);
  assert.match(prompt.payload, /Symbol: type/);
});

test('buildDetailPrompt includes requested sections', () => {
  const prompt = buildDetailPrompt(baseContext);
  assert.match(prompt.instruction, /Definition/);
  assert.match(prompt.instruction, /Example Usages/);
  assert.match(prompt.instruction, /Notes/);
  assert.match(prompt.instruction, /See Also/);
  assert.match(prompt.payload, /Definition \(/);
  assert.match(prompt.payload, /```typescript/);
});
