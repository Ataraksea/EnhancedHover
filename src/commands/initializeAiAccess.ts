import * as vscode from 'vscode';

import { INITIALIZE_AI_ACCESS_COMMAND_ID } from '../constants';
import type { LanguageModelService } from '../ai/languageModelService';
import type { DetailsViewProvider } from '../views/detailsViewProvider';

export function registerInitializeAiAccessCommand(
  languageModelService: LanguageModelService,
  detailsViewProvider: DetailsViewProvider
): vscode.Disposable {
  return vscode.commands.registerCommand(INITIALIZE_AI_ACCESS_COMMAND_ID, async () => {
    await detailsViewProvider.reveal();
    detailsViewProvider.showLoading('Enhanced Hover', ['Preparing language model access']);

    const initialized = await languageModelService.initializeAccess();
    if (initialized) {
      detailsViewProvider.showWelcome();
      return;
    }

    detailsViewProvider.showError('Enhanced Hover', 'AI access could not be initialized.');
  });
}
