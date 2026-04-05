/**
 * TentaCLAW VS Code Extension
 * Route AI inference to your local GPU cluster — no API keys, no cloud.
 */
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
    const config = () => vscode.workspace.getConfiguration('tentaclaw');

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(circuit-board) TentaCLAW';
    statusBarItem.command = 'tentaclaw.status';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Command: Cluster Status
    context.subscriptions.push(
        vscode.commands.registerCommand('tentaclaw.status', async () => {
            const gateway = config().get<string>('gatewayUrl') || 'http://localhost:8080';
            try {
                const resp = await fetch(`${gateway}/api/v1/capacity`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json() as Record<string, unknown>;
                const nodes = (data as any).online_nodes ?? 0;
                const gpus = (data as any).total_gpus ?? 0;
                const vram = Math.round(((data as any).used_vram_mb ?? 0) / 1024);
                const totalVram = Math.round(((data as any).total_vram_mb ?? 0) / 1024);
                statusBarItem.text = `$(circuit-board) ${nodes} nodes ${gpus} GPUs ${vram}/${totalVram}GB`;
                vscode.window.showInformationMessage(
                    `TentaCLAW Cluster: ${nodes} nodes, ${gpus} GPUs, ${vram}/${totalVram} GB VRAM`
                );
            } catch (e: any) {
                statusBarItem.text = '$(circuit-board) TentaCLAW (offline)';
                vscode.window.showWarningMessage(`TentaCLAW gateway not reachable at ${gateway}: ${e.message}`);
            }
        })
    );

    // Command: Chat with Local Model
    context.subscriptions.push(
        vscode.commands.registerCommand('tentaclaw.chat', async () => {
            const gateway = config().get<string>('gatewayUrl') || 'http://localhost:8080';
            const model = config().get<string>('model') || '';
            const input = await vscode.window.showInputBox({
                prompt: 'Ask your local model anything',
                placeHolder: 'How do I implement a binary search?',
            });
            if (!input) return;

            const panel = vscode.window.createWebviewPanel('tentaclawChat', 'TentaCLAW Chat', vscode.ViewColumn.Beside, {});

            try {
                const resp = await fetch(`${gateway}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model || undefined,
                        messages: [{ role: 'user', content: input }],
                        stream: false,
                    }),
                });
                const data = await resp.json() as any;
                const content = data.choices?.[0]?.message?.content || 'No response';
                panel.webview.html = `<html><body><pre style="white-space:pre-wrap;font-family:monospace;padding:20px;">${escapeHtml(content)}</pre></body></html>`;
            } catch (e: any) {
                panel.webview.html = `<html><body><p style="color:red;">Error: ${escapeHtml(e.message)}</p></body></html>`;
            }
        })
    );

    // Command: Explain Selection
    context.subscriptions.push(
        vscode.commands.registerCommand('tentaclaw.explain', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }

            const selection = editor.document.getText(editor.selection);
            if (!selection) { vscode.window.showWarningMessage('No text selected'); return; }

            const gateway = config().get<string>('gatewayUrl') || 'http://localhost:8080';
            const model = config().get<string>('model') || '';

            try {
                const resp = await fetch(`${gateway}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model || undefined,
                        messages: [{ role: 'user', content: `Explain this code concisely:\n\`\`\`\n${selection}\n\`\`\`` }],
                        stream: false,
                        max_tokens: 500,
                    }),
                });
                const data = await resp.json() as any;
                const explanation = data.choices?.[0]?.message?.content || 'No response';
                vscode.window.showInformationMessage(explanation.slice(0, 500));
            } catch (e: any) {
                vscode.window.showErrorMessage(`TentaCLAW: ${e.message}`);
            }
        })
    );

    // Command: Review Git Diff
    context.subscriptions.push(
        vscode.commands.registerCommand('tentaclaw.review', async () => {
            const gateway = config().get<string>('gatewayUrl') || 'http://localhost:8080';
            const model = config().get<string>('model') || '';

            const terminal = vscode.window.createTerminal('TentaCLAW Review');
            terminal.sendText(`tentaclaw review --model ${model || 'default'}`);
            terminal.show();
        })
    );

    // Command: Complete Code (inline)
    context.subscriptions.push(
        vscode.commands.registerCommand('tentaclaw.complete', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const position = editor.selection.active;
            const textBefore = editor.document.getText(new vscode.Range(new vscode.Position(Math.max(0, position.line - 20), 0), position));

            const gateway = config().get<string>('gatewayUrl') || 'http://localhost:8080';
            const model = config().get<string>('model') || '';

            try {
                const resp = await fetch(`${gateway}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model || undefined,
                        messages: [{ role: 'user', content: `Complete this code. Output ONLY the completion, no explanation:\n\`\`\`\n${textBefore}\n\`\`\`` }],
                        stream: false,
                        max_tokens: 200,
                        temperature: 0.1,
                    }),
                });
                const data = await resp.json() as any;
                const completion = data.choices?.[0]?.message?.content || '';
                if (completion) {
                    editor.edit(editBuilder => {
                        editBuilder.insert(position, completion.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, ''));
                    });
                }
            } catch (e: any) {
                vscode.window.showErrorMessage(`TentaCLAW: ${e.message}`);
            }
        })
    );

    // Auto-refresh status every 30s
    const interval = setInterval(async () => {
        const gateway = config().get<string>('gatewayUrl') || 'http://localhost:8080';
        try {
            const resp = await fetch(`${gateway}/api/v1/capacity`);
            if (resp.ok) {
                const data = await resp.json() as any;
                statusBarItem.text = `$(circuit-board) ${data.online_nodes ?? '?'}N ${data.total_gpus ?? '?'}G`;
            } else {
                statusBarItem.text = '$(circuit-board) TentaCLAW';
            }
        } catch {
            statusBarItem.text = '$(circuit-board) TentaCLAW (offline)';
        }
    }, 30_000);

    context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

export function deactivate(): void {
    statusBarItem?.dispose();
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
