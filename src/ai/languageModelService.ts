import * as vscode from 'vscode';

import { AI_ACCESS_INITIALIZED_KEY } from '../constants';
import { getModelSelectorSettings, getRequestTimeoutMs } from '../config/settings';
import { buildDetailPrompt, buildSummaryPrompt } from './promptBuilder';
import type { PromptSpec, SymbolContext } from '../types';

export class LanguageModelService {
  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly outputChannel: vscode.LogOutputChannel
  ) {}

  public hasInitializedAccess(): boolean {
    return this.extensionContext.globalState.get<boolean>(AI_ACCESS_INITIALIZED_KEY, false);
  }

  public async initializeAccess(): Promise<boolean> {
    const model = await this.selectModel();
    if (!model) {
      vscode.window.showWarningMessage('Enhanced Hover could not find a compatible chat model.');
      return false;
    }

    this.ensureCanSendRequest(model);

    await this.extensionContext.globalState.update(AI_ACCESS_INITIALIZED_KEY, true);
    vscode.window.showInformationMessage(`Enhanced Hover is ready to use ${model.name}.`);
    return true;
  }

  public async summarizeSymbol(
    symbolContext: SymbolContext,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    this.outputChannel.debug(`Summarizing symbol ${symbolContext.symbolName}.`);
    const responseText = await this.requestText(buildSummaryPrompt(symbolContext), token);
    const bullets = responseText
      .split(/\r?\n/)
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0)
      .slice(0, 3);

    return bullets.length > 0 ? bullets : ['AI summary was unavailable for this symbol.'];
  }

  public async streamDetailedExplanation(
    symbolContext: SymbolContext,
    onChunk: (chunk: string) => void,
    token: vscode.CancellationToken
  ): Promise<string> {
    this.outputChannel.info(`Starting detailed explanation for ${symbolContext.symbolName}.`);
    return this.withRequestTimeout(
      `generating details for ${symbolContext.symbolName}`,
      token,
      async requestToken => {
        const model = await this.getReadyModel();
        const prompt = buildDetailPrompt(symbolContext);
        const response = await model.sendRequest(this.createMessages(prompt), {
          justification: 'Provide symbol explanation details for the sidebar panel.'
        }, requestToken);

        let result = '';
        try {
          for await (const fragment of response.text) {
            result += fragment;
            onChunk(fragment);
          }
        } catch (error) {
          this.outputChannel.error('Detail stream failed.', error);
          throw error;
        }

        const trimmed = result.trim();
        this.outputChannel.info(`Detailed explanation completed for ${symbolContext.symbolName} with length ${trimmed.length}.`);
        if (trimmed.length === 0) {
          throw new Error('The selected model returned an empty detailed response.');
        }

        return trimmed;
      }
    );
  }

  private async requestText(prompt: PromptSpec, token: vscode.CancellationToken): Promise<string> {
    return this.withRequestTimeout('generating a hover summary', token, async requestToken => {
      const model = await this.getReadyModel();
      const response = await model.sendRequest(this.createMessages(prompt), {
        justification: 'Provide a concise hover summary for a symbol.'
      }, requestToken);

      let text = '';
      for await (const fragment of response.text) {
        text += fragment;
      }

      const trimmed = text.trim();
      this.outputChannel.debug(`Hover summary response length: ${trimmed.length}.`);
      if (trimmed.length === 0) {
        throw new Error('The selected model returned an empty summary response.');
      }

      return trimmed;
    });
  }

  private createMessages(prompt: PromptSpec): vscode.LanguageModelChatMessage[] {
    return [vscode.LanguageModelChatMessage.User(`${prompt.instruction}\n\n${prompt.payload}`)];
  }

  private async getReadyModel(): Promise<vscode.LanguageModelChat> {
    if (!this.hasInitializedAccess()) {
      throw new Error('AI access has not been initialized yet.');
    }

    const model = await this.selectModel();
    if (!model) {
      throw new Error('No compatible chat model is available.');
    }

    this.ensureCanSendRequest(model);

    return model;
  }

  private async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    const selector = getModelSelectorSettings();
    try {
      this.outputChannel.debug(`Selecting chat model with selector ${JSON.stringify(selector)}.`);
      let models = await this.withSimpleTimeout(
        'selecting a chat model',
        vscode.lm.selectChatModels(selector)
      );
      if (models.length === 0 && selector.vendor) {
        models = await this.withSimpleTimeout(
          'selecting a fallback chat model',
          vscode.lm.selectChatModels({ vendor: selector.vendor })
        );
      }
      if (models[0]) {
        this.outputChannel.info(`Selected model ${models[0].vendor}/${models[0].family}/${models[0].name}.`);
      }
      return models[0];
    } catch (error) {
      if (error instanceof vscode.LanguageModelError) {
        this.outputChannel.warn(`Model selection failed: ${error.code} ${error.message}`);
        return undefined;
      }

      throw error;
    }
  }

  private ensureCanSendRequest(model: vscode.LanguageModelChat): void {
    const canSendRequest = this.extensionContext.languageModelAccessInformation.canSendRequest(model);
    if (!canSendRequest) {
      throw new Error(
        'The selected model is not currently available to this extension. Re-run Initialize AI Access or check Copilot permissions and quota.'
      );
    }
  }

  private async withSimpleTimeout<T>(label: string, promise: PromiseLike<T>): Promise<T> {
    const timeoutMs = getRequestTimeoutMs();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Enhanced Hover timed out after ${timeoutMs}ms while ${label}. Check the Enhanced Hover output channel for details.`));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async withRequestTimeout<T>(
    label: string,
    parentToken: vscode.CancellationToken,
    operation: (token: vscode.CancellationToken) => Promise<T>
  ): Promise<T> {
    const timeoutMs = getRequestTimeoutMs();
    const requestCancellation = new vscode.CancellationTokenSource();
    const parentSubscription = parentToken.onCancellationRequested(() => requestCancellation.cancel());
    const timer = setTimeout(() => requestCancellation.cancel(), timeoutMs);

    try {
      return await operation(requestCancellation.token);
    } catch (error) {
      if (requestCancellation.token.isCancellationRequested && !parentToken.isCancellationRequested) {
        throw new Error(`Enhanced Hover timed out after ${timeoutMs}ms while ${label}. Check the Enhanced Hover output channel for details.`);
      }

      throw error;
    } finally {
      clearTimeout(timer);
      parentSubscription.dispose();
      requestCancellation.dispose();
    }
  }
}
