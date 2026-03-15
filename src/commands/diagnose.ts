import * as vscode from 'vscode';

import type { LanguageModelService } from '../ai/languageModelService';
import type { SymbolContextService } from '../context/symbolContextService';
import { buildLocalDetailMarkdown, buildLocalSummary } from '../context/localSummary';
import type { DetailsViewProvider } from '../views/detailsViewProvider';
import { getModelSelectorSettings } from '../config/settings';

interface DiagnoseDependencies {
  symbolContextService: SymbolContextService;
  languageModelService: LanguageModelService;
  detailsViewProvider: DetailsViewProvider;
  outputChannel: vscode.LogOutputChannel;
}

export function registerDiagnoseCommand(deps: DiagnoseDependencies): vscode.Disposable {
  return vscode.commands.registerCommand('enhancedHover.diagnose', async () => {
    await runDiagnostics(deps);
  });
}

async function runDiagnostics({
  symbolContextService,
  languageModelService,
  detailsViewProvider,
  outputChannel
}: DiagnoseDependencies): Promise<void> {
  const log = (msg: string) => outputChannel.info(`[DIAG] ${msg}`);
  const fail = (msg: string) => outputChannel.error(`[DIAG] FAIL: ${msg}`);

  outputChannel.show(true);
  log('=== Enhanced Hover Diagnostics ===');
  log(`VS Code version: ${vscode.version}`);
  log(`Platform: ${process.platform}`);

  // Step 1: Check active editor
  log('--- Step 1: Active Editor ---');
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    fail('No active text editor. Open a file and place cursor on a symbol, then re-run.');
    return;
  }
  const doc = editor.document;
  const pos = editor.selection.active;
  log(`File: ${doc.uri.toString()}`);
  log(`Language: ${doc.languageId}`);
  log(`Position: line=${pos.line} char=${pos.character}`);
  log(`Word at position: "${doc.getText(doc.getWordRangeAtPosition(pos))}"`);
  log('PASS');

  // Step 2: Test sidebar reveal
  log('--- Step 2: Sidebar Reveal ---');
  try {
    await detailsViewProvider.reveal();
    log('PASS - reveal() completed without error');
  } catch (error) {
    fail(`reveal() threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Step 3: Test sidebar rendering
  log('--- Step 3: Sidebar Rendering ---');
  try {
    detailsViewProvider.showDetail('Diagnostic Test', ['Test summary line 1', 'Test summary line 2'], '## Diagnostic\n\nIf you can read this, the sidebar webview is working correctly.\n\n- Item 1\n- Item 2');
    log('PASS - showDetail() completed without error');
  } catch (error) {
    fail(`showDetail() threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Give user a moment to see the test content
  await sleep(1500);

  // Step 4: Symbol context gathering
  log('--- Step 4: Symbol Context ---');
  let symbolContext;
  try {
    const cts = new vscode.CancellationTokenSource();
    const timeout = setTimeout(() => cts.cancel(), 10_000);
    symbolContext = await symbolContextService.getContext(doc, pos, 'detail', cts.token);
    clearTimeout(timeout);
    cts.dispose();

    if (!symbolContext) {
      fail('getContext() returned undefined. No symbol found at cursor position.');
    } else {
      log(`symbolName: ${symbolContext.symbolName}`);
      log(`symbolKind: ${symbolContext.symbolKind ?? 'undefined'}`);
      log(`containerName: ${symbolContext.containerName ?? 'undefined'}`);
      log(`hoverTexts: ${symbolContext.hoverTexts.length} entries`);
      for (const ht of symbolContext.hoverTexts) {
        log(`  hover: "${ht.substring(0, 80)}${ht.length > 80 ? '...' : ''}"`);
      }
      log(`definition: ${symbolContext.definition ? symbolContext.definition.uri.toString() : 'none'}`);
      log(`definitionSnippet: ${symbolContext.definitionSnippet ? `${symbolContext.definitionSnippet.code.length} chars` : 'none'}`);
      log(`references: ${symbolContext.references.length} found`);
      log(`key: ${symbolContext.key}`);
      log('PASS');
    }
  } catch (error) {
    fail(`getContext() threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }

  // Step 5: Local summary
  log('--- Step 5: Local Summary ---');
  if (symbolContext) {
    try {
      const localSummary = buildLocalSummary(symbolContext);
      log(`Local summary lines: ${localSummary.length}`);
      for (const line of localSummary) {
        log(`  "${line}"`);
      }

      const localDetail = buildLocalDetailMarkdown(symbolContext);
      log(`Local detail markdown length: ${localDetail.length}`);
      log('PASS');

      // Show local detail in sidebar
      detailsViewProvider.showDetail(symbolContext.symbolName, localSummary, localDetail);
      log('Local detail rendered in sidebar.');
    } catch (error) {
      fail(`buildLocalSummary/buildLocalDetailMarkdown threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    log('SKIPPED - no symbol context');
  }

  // Step 6: Language model availability
  log('--- Step 6: Language Model ---');
  log(`hasInitializedAccess: ${languageModelService.hasInitializedAccess()}`);
  const modelSelector = getModelSelectorSettings();
  log(`Model selector: ${JSON.stringify(modelSelector)}`);

  try {
    const models = await vscode.lm.selectChatModels(modelSelector);
    log(`Models found with selector: ${models.length}`);
    for (const m of models) {
      log(`  model: vendor=${m.vendor} family=${m.family} name=${m.name} id=${m.id} maxInputTokens=${m.maxInputTokens}`);
    }

    if (models.length === 0 && modelSelector.vendor) {
      const fallbackModels = await vscode.lm.selectChatModels({ vendor: modelSelector.vendor });
      log(`Fallback models (vendor only): ${fallbackModels.length}`);
      for (const m of fallbackModels) {
        log(`  model: vendor=${m.vendor} family=${m.family} name=${m.name} id=${m.id}`);
      }
    }

    if (models.length === 0) {
      log('No models available. Listing ALL models...');
      const allModels = await vscode.lm.selectChatModels({});
      log(`Total models on system: ${allModels.length}`);
      for (const m of allModels) {
        log(`  model: vendor=${m.vendor} family=${m.family} name=${m.name} id=${m.id}`);
      }
    }
    log('PASS');
  } catch (error) {
    fail(`selectChatModels threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Step 7: Quick LM test (if initialized and model available)
  if (symbolContext && languageModelService.hasInitializedAccess()) {
    log('--- Step 7: LM Request Test ---');
    try {
      const cts = new vscode.CancellationTokenSource();
      const timeout = setTimeout(() => cts.cancel(), 15_000);

      let chunks = 0;
      const detail = await languageModelService.streamDetailedExplanation(
        symbolContext,
        _chunk => { chunks++; },
        cts.token
      );
      clearTimeout(timeout);
      cts.dispose();

      log(`LM response length: ${detail.length}`);
      log(`LM response chunks: ${chunks}`);
      log(`LM response preview: "${detail.substring(0, 200)}..."`);
      log('PASS');

      detailsViewProvider.showDetail(symbolContext.symbolName, buildLocalSummary(symbolContext), detail);
      log('AI-generated detail rendered in sidebar.');
    } catch (error) {
      fail(`streamDetailedExplanation threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  } else {
    log('--- Step 7: LM Request Test ---');
    log(`SKIPPED - ${!symbolContext ? 'no symbol context' : 'AI access not initialized'}`);
  }

  log('=== Diagnostics Complete ===');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
