import * as vscode from 'vscode';

import { DETAILS_VIEW_ID, SIDEBAR_CONTAINER_ID } from '../constants';

type ViewStatus = 'welcome' | 'loading' | 'needs-init' | 'ready' | 'error';

interface DetailsViewState {
  status: ViewStatus;
  title: string;
  subtitle?: string;
  summary: string[];
  detailMarkdown?: string;
}

export class DetailsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private viewReadyResolve?: () => void;
  private viewReadyPromise?: Promise<void>;
  private state: DetailsViewState = {
    status: 'welcome',
    title: 'Enhanced Hover',
    subtitle: 'Initialize AI access to enable summary prefetch and long-form explanations.',
    summary: []
  };

  constructor(private readonly extensionUri: vscode.Uri) {}

  public async reveal(): Promise<void> {
    if (!this.view) {
      this.viewReadyPromise = new Promise<void>(resolve => {
        this.viewReadyResolve = resolve;
      });
    }
    await vscode.commands.executeCommand(`workbench.view.extension.${SIDEBAR_CONTAINER_ID}`);
    if (this.viewReadyPromise) {
      await this.viewReadyPromise;
      this.viewReadyPromise = undefined;
    }
    this.view?.show?.(true);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    if (this.viewReadyResolve) {
      this.viewReadyResolve();
      this.viewReadyResolve = undefined;
    }

    void this.render();
  }

  public showWelcome(): void {
    this.state = {
      status: 'welcome',
      title: 'Enhanced Hover',
      subtitle: 'Hover a symbol and choose Read more to inspect it here.',
      summary: []
    };
    void this.render();
  }

  public showLoading(title: string, summary: string[]): void {
    this.state = {
      status: 'loading',
      title,
      subtitle: 'Generating explanation...',
      summary,
      detailMarkdown: ''
    };
    void this.render();
  }

  public showNeedsInitialization(title: string, summary: string[]): void {
    this.state = {
      status: 'needs-init',
      title,
      subtitle: 'Run “Enhanced Hover: Initialize AI Access” to enable AI explanations.',
      summary
    };
    void this.render();
  }

  public appendDetailChunk(chunk: string): void {
    this.state = {
      ...this.state,
      status: 'loading',
      detailMarkdown: `${this.state.detailMarkdown ?? ''}${chunk}`
    };
    void this.render();
  }

  public showDetail(title: string, summary: string[], detailMarkdown: string): void {
    this.state = {
      status: 'ready',
      title,
      subtitle: undefined,
      summary,
      detailMarkdown
    };
    void this.render();
  }

  public showError(title: string, message: string, summary: string[] = []): void {
    this.state = {
      status: 'error',
      title,
      subtitle: message,
      summary
    };
    void this.render();
  }

  private async render(): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({
      type: 'state',
      state: this.state
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'detailsView.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'detailsView.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>${DETAILS_VIEW_ID}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
