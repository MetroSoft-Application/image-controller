import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * VS Code拡張機能のアクティベート関数
 * Image Controller拡張機能を初期化し、必要なプロバイダーとコマンドを登録する
 * @param context VS Code拡張機能のコンテキスト
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Image Controller extension is now active!');

    // カスタムエディタプロバイダーを登録
    const provider = new ImageViewerProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('imageController.imageViewer', provider)
    );

    // コマンドを登録
    context.subscriptions.push(
        vscode.commands.registerCommand('imageController.nextImage', () => provider.nextImage()),
        vscode.commands.registerCommand('imageController.prevImage', () => provider.prevImage()),
        vscode.commands.registerCommand('imageController.nextFolder', () => provider.nextFolder()),
        vscode.commands.registerCommand('imageController.prevFolder', () => provider.prevFolder()),
        vscode.commands.registerCommand('imageController.deleteImage', () => provider.deleteImage()),
        vscode.commands.registerCommand('imageController.copyImage', () => provider.copyImage()),
        vscode.commands.registerCommand('imageController.rotateImage', () => provider.rotateImage()),
        vscode.commands.registerCommand('imageController.resetZoom', () => provider.resetZoom())
    );
}

/**
 * 画像ビューアのカスタムエディタプロバイダークラス
 * 画像ファイルの表示、ナビゲーション、操作機能を提供する
 */
class ImageViewerProvider implements vscode.CustomReadonlyEditorProvider {
    private static readonly viewType = 'imageController.imageViewer';
    /** アクティブなWebviewパネル */
    private activeWebview: vscode.WebviewPanel | undefined;
    /** 現在表示中の画像ファイルパス */
    private currentImagePath: string | undefined;
    /** 現在のフォルダ内の画像ファイル一覧 */
    private imageFiles: string[] = [];
    /** 現在表示中の画像のインデックス */
    private currentIndex: number = 0;
    /** 画像読み込み中フラグ */
    private isLoading: boolean = false;

    constructor(private readonly context: vscode.ExtensionContext) { }

    /**
     * カスタムドキュメントを開く
     * @param uri ファイルのURI
     * @returns カスタムドキュメント
     */
    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose: () => { } };
    }

    /**
     * カスタムエディタを解決し、Webviewを初期化する
     * @param document カスタムドキュメント
     * @param webviewPanel Webviewパネル
     */
    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        this.activeWebview = webviewPanel;
        this.currentImagePath = document.uri.fsPath;

        // 同じフォルダの画像ファイルを取得
        await this.updateImageList();

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.dirname(document.uri.fsPath)),
                // 親ディレクトリも追加してフォルダ移動に対応
                vscode.Uri.file(path.dirname(path.dirname(document.uri.fsPath)))
            ]
        };

        webviewPanel.webview.html = this.getHtmlContent(document.uri);

        // Webviewからのメッセージを処理
        webviewPanel.webview.onDidReceiveMessage(async message => {
            // ローディング中は新しいリクエストを無視
            if (this.isLoading) {
                return;
            }

            try {
                switch (message.command) {
                    case 'nextImage':
                        await this.nextImage();
                        break;
                    case 'prevImage':
                        await this.prevImage();
                        break;
                    case 'nextFolder':
                        await this.nextFolder();
                        break;
                    case 'prevFolder':
                        await this.prevFolder();
                        break;
                    case 'deleteImage':
                        await this.deleteImage();
                        break;
                    case 'copyImage':
                        await this.copyImage();
                        break;
                    case 'rotateImage':
                        this.rotateImage();
                        break;
                    case 'resetZoom':
                        this.resetZoom();
                        break;
                }
            } finally {
                // 操作完了をWebviewに通知
                if (webviewPanel.webview) {
                    webviewPanel.webview.postMessage({ command: 'operationComplete' });
                }
            }
        });
    }

    /**
     * 現在のフォルダ内の画像ファイル一覧を更新する
     */
    private async updateImageList(): Promise<void> {
        if (!this.currentImagePath) {
            return;
        }

        const currentDir = path.dirname(this.currentImagePath);
        const files = await fs.promises.readdir(currentDir);

        this.imageFiles = files
            .filter(file => this.isImageFile(file))
            .map(file => path.join(currentDir, file))
            .sort();

        this.currentIndex = this.imageFiles.indexOf(this.currentImagePath);
    }

    /**
     * ファイル名から画像ファイルかどうかを判定する
     * @param filename ファイル名
     * @returns 画像ファイルの場合true
     */
    private isImageFile(filename: string): boolean {
        const ext = path.extname(filename).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(ext);
    }

    /**
     * 次の画像に移動する
     */
    async nextImage(): Promise<void> {
        if (this.imageFiles.length === 0 || this.isLoading) {
            return;
        }

        this.isLoading = true;
        try {
            this.currentIndex = (this.currentIndex + 1) % this.imageFiles.length;
            console.log(`Moving to next image: index ${this.currentIndex}, path: ${this.imageFiles[this.currentIndex]}`);
            await this.loadImage();
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 前の画像に移動する
     */
    async prevImage(): Promise<void> {
        if (this.imageFiles.length === 0 || this.isLoading) {
            return;
        }

        this.isLoading = true;
        try {
            this.currentIndex = this.currentIndex === 0 ? this.imageFiles.length - 1 : this.currentIndex - 1;
            console.log(`Moving to previous image: index ${this.currentIndex}, path: ${this.imageFiles[this.currentIndex]}`);
            await this.loadImage();
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 次のフォルダの最初の画像に移動する
     */
    async nextFolder(): Promise<void> {
        if (!this.currentImagePath || this.isLoading) {
            return;
        }

        this.isLoading = true;
        try {
            const currentDir = path.dirname(this.currentImagePath);
            const parentDir = path.dirname(currentDir);
            console.log(`Navigating to next folder from: ${currentDir}`);

            const folders = await fs.promises.readdir(parentDir);
            const subFolders = [];

            for (const folder of folders) {
                const folderPath = path.join(parentDir, folder);
                const stat = await fs.promises.stat(folderPath);
                if (stat.isDirectory()) {
                    subFolders.push(folderPath);
                }
            }

            subFolders.sort();
            const currentFolderIndex = subFolders.indexOf(currentDir);

            if (currentFolderIndex >= 0 && currentFolderIndex < subFolders.length - 1) {
                const nextFolderPath = subFolders[currentFolderIndex + 1];
                console.log(`Moving to next folder: ${nextFolderPath}`);
                await this.loadFirstImageFromFolder(nextFolderPath);
            }
        } catch (error) {
            console.error('Error navigating to next folder:', error);
            vscode.window.showErrorMessage(`Failed to navigate to next folder: ${error}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 前のフォルダの最初の画像に移動する
     */
    async prevFolder(): Promise<void> {
        if (!this.currentImagePath || this.isLoading) {
            return;
        }

        this.isLoading = true;
        try {
            const currentDir = path.dirname(this.currentImagePath);
            const parentDir = path.dirname(currentDir);
            console.log(`Navigating to previous folder from: ${currentDir}`);

            const folders = await fs.promises.readdir(parentDir);
            const subFolders = [];

            for (const folder of folders) {
                const folderPath = path.join(parentDir, folder);
                const stat = await fs.promises.stat(folderPath);
                if (stat.isDirectory()) {
                    subFolders.push(folderPath);
                }
            }

            subFolders.sort();
            const currentFolderIndex = subFolders.indexOf(currentDir);

            if (currentFolderIndex > 0) {
                const prevFolderPath = subFolders[currentFolderIndex - 1];
                console.log(`Moving to previous folder: ${prevFolderPath}`);
                await this.loadFirstImageFromFolder(prevFolderPath);
            }
        } catch (error) {
            console.error('Error navigating to previous folder:', error);
            vscode.window.showErrorMessage(`Failed to navigate to previous folder: ${error}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 指定されたフォルダから最初の画像を読み込む
     * @param folderPath フォルダパス
     */
    private async loadFirstImageFromFolder(folderPath: string): Promise<void> {
        try {
            console.log(`Loading first image from folder: ${folderPath}`);
            const files = await fs.promises.readdir(folderPath);
            const imageFiles = files
                .filter(file => this.isImageFile(file))
                .sort();

            if (imageFiles.length > 0) {
                const imagePath = path.join(folderPath, imageFiles[0]);
                console.log(`Opening first image: ${imagePath}`);

                // 現在のWebviewで画像を更新
                this.currentImagePath = imagePath;
                await this.updateImageList();
                await this.loadImage();
            } else {
                vscode.window.showInformationMessage(`No images found in folder: ${path.basename(folderPath)}`);
            }
        } catch (error) {
            console.error('Error loading first image from folder:', error);
            vscode.window.showErrorMessage(`Failed to load images from folder: ${error}`);
        }
    }

    /**
     * 現在のインデックスの画像を読み込んでWebviewに表示する
     */
    private async loadImage(): Promise<void> {
        if (!this.activeWebview || this.imageFiles.length === 0) {
            return;
        }

        this.currentImagePath = this.imageFiles[this.currentIndex];
        const uri = vscode.Uri.file(this.currentImagePath);
        this.activeWebview.webview.html = this.getHtmlContent(uri);
    }

    /**
     * 現在の画像を削除する（確認ダイアログ付き）
     */
    async deleteImage(): Promise<void> {
        if (!this.currentImagePath || this.isLoading) {
            return;
        }

        const result = await vscode.window.showWarningMessage(
            `Delete ${path.basename(this.currentImagePath)}?`,
            'Yes', 'No'
        );

        if (result === 'Yes') {
            this.isLoading = true;
            try {
                await fs.promises.unlink(this.currentImagePath);
                vscode.window.showInformationMessage('Image deleted successfully');

                // 次の画像に移動
                this.imageFiles.splice(this.currentIndex, 1);
                if (this.imageFiles.length === 0) {
                    this.activeWebview?.dispose();
                } else {
                    if (this.currentIndex >= this.imageFiles.length) {
                        this.currentIndex = this.imageFiles.length - 1;
                    }
                    await this.loadImage();
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete image: ${error}`);
            } finally {
                this.isLoading = false;
            }
        }
    }

    /**
     * 現在の画像のパスをクリップボードにコピーする
     */
    async copyImage(): Promise<void> {
        if (!this.currentImagePath) {
            return;
        }

        try {
            const uri = vscode.Uri.file(this.currentImagePath);
            await vscode.env.clipboard.writeText(uri.toString());
            vscode.window.showInformationMessage('Image path copied to clipboard');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to copy image: ${error}`);
        }
    }

    /**
     * 画像を90度回転する
     */
    rotateImage(): void {
        if (!this.activeWebview) {
            return;
        }
        this.activeWebview.webview.postMessage({ command: 'rotate' });
    }

    /**
     * 画像のズームと位置をリセットする
     */
    resetZoom(): void {
        if (!this.activeWebview) {
            return;
        }
        this.activeWebview.webview.postMessage({ command: 'resetZoom' });
    }

    /**
     * Webview用のHTMLコンテンツを生成する
     * @param uri 画像ファイルのURI
     * @returns HTMLコンテンツ
     */
    private getHtmlContent(uri: vscode.Uri): string {
        try {
            const webviewUri = this.activeWebview?.webview.asWebviewUri(uri);

            // テンプレートファイルの場所を複数試す
            const possibleTemplatePaths = [
                path.join(this.context.extensionPath, 'src', 'template.html'),
                path.join(this.context.extensionPath, 'template.html'),
                path.join(this.context.extensionPath, 'out', 'template.html')
            ];

            let templatePath: string | undefined;
            for (const possiblePath of possibleTemplatePaths) {
                if (fs.existsSync(possiblePath)) {
                    templatePath = possiblePath;
                    break;
                }
            }

            if (!templatePath) {
                throw new Error(`Template file not found in any of the expected locations: ${possibleTemplatePaths.join(', ')}`);
            }

            let htmlContent = fs.readFileSync(templatePath, 'utf8');

            // テンプレートの置換
            htmlContent = htmlContent.replace(/{{{IMAGE_URI}}}/g, webviewUri?.toString() || '');
            htmlContent = htmlContent.replace(/{{{FILE_NAME}}}/g, path.basename(uri.fsPath));

            return htmlContent;
        } catch (error) {
            console.error('Error loading HTML template:', error);
            // フォールバック：シンプルなHTMLを返す
            const webviewUri = this.activeWebview?.webview.asWebviewUri(uri);
            return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>Image Controller</title>
</head>
<body>
    <img src="${webviewUri}" alt="Image" style="max-width: 100%; max-height: 100%;">
    <p>Error loading template: ${error}</p>
</body>
</html>`;
        }
    }
}

/**
 * VS Code拡張機能の非アクティベート関数
 * 拡張機能が無効化される際に呼び出される
 */
export function deactivate() {
    console.log('Image Controller extension is now deactivated.');
}
