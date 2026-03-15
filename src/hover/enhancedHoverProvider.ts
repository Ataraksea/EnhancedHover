import * as vscode from 'vscode';

import type { LanguageModelService } from '../ai/languageModelService';
import type { ExplanationCache } from '../cache/explanationCache';
import { OPEN_DETAILS_COMMAND_ID } from '../constants';
import { getHoverDwellMs, getPrefetchEnabled } from '../config/settings';
import { buildLocalSummary } from '../context/localSummary';
import type { SymbolContextService } from '../context/symbolContextService';
import type { ExplanationRecord, OpenSymbolRequest, SymbolContext } from '../types';

export class EnhancedHoverProvider implements vscode.HoverProvider {
  private readonly prefetchTimers = new Map<string, NodeJS.Timeout>();
  private gatheringContext = false;

  constructor(
    private readonly symbolContextService: SymbolContextService,
    private readonly explanationCache: ExplanationCache,
    private readonly languageModelService: LanguageModelService,
    private readonly outputChannel: vscode.LogOutputChannel,
    private readonly getSourceVersion: (document: vscode.TextDocument) => number
  ) {}

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    if (this.gatheringContext) {
      return undefined;
    }

    this.gatheringContext = true;
    try {
      return await this.doProvideHover(document, position, token);
    } finally {
      this.gatheringContext = false;
    }
  }

  private async doProvideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const symbolContext = await this.symbolContextService.getContext(document, position, 'summary', token);
    if (!symbolContext) {
      return undefined;
    }

    const cached = this.explanationCache.get(symbolContext.key, this.getSourceVersion(document));
    const summary = cached?.summary.length ? cached.summary : buildLocalSummary(symbolContext);
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = { enabledCommands: [OPEN_DETAILS_COMMAND_ID] };

    for (const line of summary) {
      markdown.appendMarkdown(`- ${escapeMarkdown(line)}\n`);
    }

    if (!cached?.summary.length && !this.languageModelService.hasInitializedAccess()) {
      markdown.appendMarkdown('\nInitialize AI access to enable richer hover summaries.\n');
    }

    const args = encodeURIComponent(JSON.stringify([this.createOpenRequest(document.uri, position)]));
    markdown.appendMarkdown(`\n[Read more](command:${OPEN_DETAILS_COMMAND_ID}?${args})`);

    this.schedulePrefetch(symbolContext, document.version, token);
    return new vscode.Hover(markdown, symbolContext.wordRange);
  }

  private schedulePrefetch(
    symbolContext: SymbolContext,
    sourceVersion: number,
    token: vscode.CancellationToken
  ): void {
    if (!getPrefetchEnabled() || !this.languageModelService.hasInitializedAccess()) {
      return;
    }

    const existing = this.explanationCache.get(symbolContext.key, sourceVersion);
    if (existing?.summary.length) {
      return;
    }

    const existingTimer = this.prefetchTimers.get(symbolContext.key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.prefetchTimers.delete(symbolContext.key);
      void this.prefetchSummary(symbolContext, sourceVersion);
    }, getHoverDwellMs());

    this.prefetchTimers.set(symbolContext.key, timer);
    const subscription = token.onCancellationRequested(() => {
      clearTimeout(timer);
      this.prefetchTimers.delete(symbolContext.key);
      subscription.dispose();
    });
  }

  private async prefetchSummary(symbolContext: SymbolContext, sourceVersion: number): Promise<void> {
    const cancellation = new vscode.CancellationTokenSource();
    try {
      await this.explanationCache.getOrCreate(symbolContext.key, 'summary', async (): Promise<ExplanationRecord> => {
        const summary = await this.languageModelService.summarizeSymbol(symbolContext, cancellation.token);
        return {
          key: symbolContext.key,
          summary,
          createdAt: Date.now(),
          sourceVersion
        };
      }, sourceVersion);
    } catch (error) {
      this.outputChannel.warn(`Summary prefetch failed for ${symbolContext.symbolName}.`, error);
    } finally {
      cancellation.dispose();
    }
  }

  private createOpenRequest(uri: vscode.Uri, position: vscode.Position): OpenSymbolRequest {
    return {
      uri: uri.toString(),
      line: position.line,
      character: position.character
    };
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!-]/g, '\\$&');
}
