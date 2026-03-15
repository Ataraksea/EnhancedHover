import * as vscode from 'vscode';

import { LanguageModelService } from './ai/languageModelService';
import { ExplanationCache } from './cache/explanationCache';
import {
  OPEN_DETAILS_COMMAND_ID,
  REFRESH_CURRENT_SYMBOL_COMMAND_ID,
  SIDEBAR_CONTAINER_ID,
  DETAILS_VIEW_ID
} from './constants';
import { registerDiagnoseCommand } from './commands/diagnose';
import { registerInitializeAiAccessCommand } from './commands/initializeAiAccess';
import { getCacheTtlMs, getSupportedDocumentSelector } from './config/settings';
import { buildLocalDetailMarkdown, buildLocalSummary } from './context/localSummary';
import { SymbolContextService } from './context/symbolContextService';
import { EnhancedHoverProvider } from './hover/enhancedHoverProvider';
import type { OpenSymbolRequest } from './types';
import { DetailsViewProvider } from './views/detailsViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Enhanced Hover', { log: true });
  const explanationCache = new ExplanationCache(getCacheTtlMs());
  const symbolContextService = new SymbolContextService();
  const detailsViewProvider = new DetailsViewProvider(context.extensionUri);
  const languageModelService = new LanguageModelService(context, outputChannel);

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DETAILS_VIEW_ID, detailsViewProvider)
  );
  context.subscriptions.push(
    registerInitializeAiAccessCommand(languageModelService, detailsViewProvider)
  );
  context.subscriptions.push(
    registerDiagnoseCommand({ symbolContextService, languageModelService, detailsViewProvider, outputChannel })
  );

  const hoverProvider = new EnhancedHoverProvider(
    symbolContextService,
    explanationCache,
    languageModelService,
    outputChannel,
    document => document.version
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(getSupportedDocumentSelector(), hoverProvider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration('enhancedHover.cacheTtlMs')) {
        explanationCache.updateTtl(getCacheTtlMs());
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_DETAILS_COMMAND_ID, async (...args: unknown[]) => {
      const resolvedRequest = normalizeOpenSymbolRequest(args);
      if (!resolvedRequest) {
        void vscode.window.showInformationMessage('Enhanced Hover could not determine a symbol from the active editor.');
        return;
      }

      await openSymbolDetails({
        request: resolvedRequest,
        forceRefresh: false,
        symbolContextService,
        explanationCache,
        languageModelService,
        detailsViewProvider,
        outputChannel
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(REFRESH_CURRENT_SYMBOL_COMMAND_ID, async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }

      await openSymbolDetails({
        request: {
          uri: activeEditor.document.uri.toString(),
          line: activeEditor.selection.active.line,
          character: activeEditor.selection.active.character
        },
        forceRefresh: true,
        symbolContextService,
        explanationCache,
        languageModelService,
        detailsViewProvider,
        outputChannel
      });
    })
  );

  void vscode.commands.executeCommand(`setContext`, `${SIDEBAR_CONTAINER_ID}.enabled`, true);
}

export function deactivate(): void {}

interface OpenDetailsDependencies {
  request: OpenSymbolRequest;
  forceRefresh: boolean;
  symbolContextService: SymbolContextService;
  explanationCache: ExplanationCache;
  languageModelService: LanguageModelService;
  detailsViewProvider: DetailsViewProvider;
  outputChannel: vscode.LogOutputChannel;
}

async function openSymbolDetails({
  request,
  forceRefresh,
  symbolContextService,
  explanationCache,
  languageModelService,
  detailsViewProvider,
  outputChannel
}: OpenDetailsDependencies): Promise<void> {
  try {
    outputChannel.info(`Opening symbol details for ${request.uri}:${request.line + 1}:${request.character + 1}.`);

    outputChannel.info('[step 1] Revealing sidebar view...');
    await detailsViewProvider.reveal();
    outputChannel.info('[step 1] Sidebar view revealed.');

    outputChannel.info('[step 2] Parsing URI and opening document...');
    const parsedUri = vscode.Uri.parse(request.uri);
    outputChannel.info(`[step 2] Parsed URI scheme=${parsedUri.scheme} path=${parsedUri.path} fsPath=${parsedUri.fsPath}`);
    const document = await vscode.workspace.openTextDocument(parsedUri);
    outputChannel.info(`[step 2] Document opened: ${document.uri.toString()} languageId=${document.languageId} version=${document.version}`);

    const position = new vscode.Position(request.line, request.character);
    outputChannel.info(`[step 3] Gathering symbol context at line=${position.line} char=${position.character}...`);
    const contextCancellation = new vscode.CancellationTokenSource();
    const symbolContext = await symbolContextService.getContext(document, position, 'detail', contextCancellation.token);
    contextCancellation.dispose();

    if (!symbolContext) {
      outputChannel.warn('[step 3] No symbol context returned. Showing error in sidebar.');
      detailsViewProvider.showError('Symbol Details', 'No symbol information was available at this position.');
      return;
    }
    outputChannel.info(`[step 3] Symbol context gathered: name=${symbolContext.symbolName} kind=${symbolContext.symbolKind ?? 'unknown'} hoverTexts=${symbolContext.hoverTexts.length} refs=${symbolContext.references.length}`);

    const fallbackSummary = buildLocalSummary(symbolContext);
    const cached = forceRefresh ? undefined : explanationCache.get(symbolContext.key, document.version);
    if (cached?.detailMarkdown) {
      outputChannel.info('[step 4] Using cached detail markdown.');
      detailsViewProvider.showDetail(symbolContext.symbolName, cached.summary, cached.detailMarkdown);
      return;
    }

    if (!languageModelService.hasInitializedAccess()) {
      outputChannel.info('[step 5] AI access not initialized. Showing local fallback.');
      const fallbackDetailMarkdown = buildLocalDetailMarkdown(symbolContext);
      detailsViewProvider.showDetail(symbolContext.symbolName, fallbackSummary, fallbackDetailMarkdown);

      // Non-blocking: offer initialization without blocking the function
      void vscode.window.showInformationMessage(
        'Enhanced Hover: Run "Initialize AI Access" for AI-generated explanations. Showing local analysis.',
        'Initialize Now'
      ).then(async action => {
        if (action === 'Initialize Now') {
          outputChannel.info('[step 5] User chose to initialize. Running initializeAccess...');
          await languageModelService.initializeAccess();
        }
      });
      return;
    }

    const summary = cached?.summary ?? fallbackSummary;
    outputChannel.info(`[step 6] Showing loading state for ${symbolContext.symbolName}...`);
    detailsViewProvider.showLoading(symbolContext.symbolName, summary);

    const cancellation = new vscode.CancellationTokenSource();
    try {
      outputChannel.info('[step 7] Starting LM stream...');
      const detailMarkdown = await languageModelService.streamDetailedExplanation(
        symbolContext,
        chunk => detailsViewProvider.appendDetailChunk(chunk),
        cancellation.token
      );
      outputChannel.info(`[step 7] LM stream complete. Length=${detailMarkdown.length}`);

      const record = explanationCache.set({
        key: symbolContext.key,
        summary,
        detailMarkdown,
        createdAt: Date.now(),
        sourceVersion: document.version
      });

      detailsViewProvider.showDetail(symbolContext.symbolName, record.summary, record.detailMarkdown ?? detailMarkdown);
      outputChannel.info('[step 8] Detail view updated with AI content.');
    } catch (error) {
      outputChannel.error(`[step 7] LM stream failed for ${symbolContext.symbolName}:`, error);
      const fallbackDetailMarkdown = buildLocalDetailMarkdown(symbolContext);
      detailsViewProvider.showDetail(symbolContext.symbolName, summary, fallbackDetailMarkdown);
      outputChannel.info('[step 7] Showing local fallback after LM failure.');
    } finally {
      cancellation.dispose();
    }
  } catch (error) {
    outputChannel.error('[FATAL] openSymbolDetails crashed:', error);
    try {
      detailsViewProvider.showError('Error', `Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
    } catch (renderError) {
      outputChannel.error('[FATAL] Could not even render error state:', renderError);
    }
  }
}

function normalizeOpenSymbolRequest(args: unknown[]): OpenSymbolRequest | undefined {
  const firstArgument = unwrapFirstCommandArgument(args);
  const directRequest = asOpenSymbolRequest(firstArgument);
  if (directRequest) {
    return directRequest;
  }

  const uri = asUriLike(firstArgument);
  if (uri) {
    return getOpenSymbolRequestFromActiveEditor(uri.toString());
  }

  if (isObjectLike(firstArgument)) {
    const candidateRecord = firstArgument as Record<string, unknown>;
    const nestedUri = asUriLike(candidateRecord.resourceUri) ?? asUriLike(candidateRecord.uri);
    if (nestedUri) {
      return getOpenSymbolRequestFromActiveEditor(nestedUri.toString());
    }
  }

  return getOpenSymbolRequestFromActiveEditor();
}

function unwrapFirstCommandArgument(args: unknown[]): unknown {
  if (args.length === 0) {
    return undefined;
  }

  const [firstArgument] = args;
  if (Array.isArray(firstArgument) && firstArgument.length === 1) {
    return firstArgument[0];
  }

  return firstArgument;
}

function asOpenSymbolRequest(value: unknown): OpenSymbolRequest | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record.uri === 'string' && typeof record.line === 'number' && typeof record.character === 'number'
    ? {
        uri: record.uri,
        line: record.line,
        character: record.character
      }
    : undefined;
}

function asUriLike(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value;
  }

  if (!isObjectLike(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record.scheme === 'string' && typeof record.path === 'string'
    ? vscode.Uri.from({
        scheme: record.scheme,
        authority: typeof record.authority === 'string' ? record.authority : '',
        path: record.path,
        query: typeof record.query === 'string' ? record.query : '',
        fragment: typeof record.fragment === 'string' ? record.fragment : ''
      })
    : undefined;
}

function getOpenSymbolRequestFromActiveEditor(preferredUri?: string): OpenSymbolRequest | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return undefined;
  }

  if (preferredUri && activeEditor.document.uri.toString() !== preferredUri) {
    return {
      uri: preferredUri,
      line: activeEditor.selection.active.line,
      character: activeEditor.selection.active.character
    };
  }

  return {
    uri: activeEditor.document.uri.toString(),
    line: activeEditor.selection.active.line,
    character: activeEditor.selection.active.character
  };
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
