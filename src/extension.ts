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
            localResourceRoots: [vscode.Uri.file(path.dirname(document.uri.fsPath))]
        };

        webviewPanel.webview.html = this.getHtmlContent(document.uri);

        // Webviewからのメッセージを処理
        webviewPanel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'nextImage':
                    this.nextImage();
                    break;
                case 'prevImage':
                    this.prevImage();
                    break;
                case 'nextFolder':
                    this.nextFolder();
                    break;
                case 'prevFolder':
                    this.prevFolder();
                    break;
                case 'deleteImage':
                    this.deleteImage();
                    break;
                case 'copyImage':
                    this.copyImage();
                    break;
                case 'rotateImage':
                    this.rotateImage();
                    break;
                case 'resetZoom':
                    this.resetZoom();
                    break;
            }
        });
    }

    /**
     * 現在のフォルダ内の画像ファイル一覧を更新する
     */
    private async updateImageList(): Promise<void> {
        if (!this.currentImagePath) return;

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
        if (this.imageFiles.length === 0) return;

        this.currentIndex = (this.currentIndex + 1) % this.imageFiles.length;
        await this.loadImage();
    }

    /**
     * 前の画像に移動する
     */
    async prevImage(): Promise<void> {
        if (this.imageFiles.length === 0) return;

        this.currentIndex = this.currentIndex === 0 ? this.imageFiles.length - 1 : this.currentIndex - 1;
        await this.loadImage();
    }

    /**
     * 次のフォルダの最初の画像に移動する
     */
    async nextFolder(): Promise<void> {
        if (!this.currentImagePath) return;

        const currentDir = path.dirname(this.currentImagePath);
        const parentDir = path.dirname(currentDir);

        try {
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
                await this.loadFirstImageFromFolder(nextFolderPath);
            }
        } catch (error) {
            console.error('Error navigating to next folder:', error);
        }
    }

    /**
     * 前のフォルダの最初の画像に移動する
     */
    async prevFolder(): Promise<void> {
        if (!this.currentImagePath) return;

        const currentDir = path.dirname(this.currentImagePath);
        const parentDir = path.dirname(currentDir);

        try {
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
                await this.loadFirstImageFromFolder(prevFolderPath);
            }
        } catch (error) {
            console.error('Error navigating to previous folder:', error);
        }
    }

    /**
     * 指定されたフォルダから最初の画像を読み込む
     * @param folderPath フォルダパス
     */
    private async loadFirstImageFromFolder(folderPath: string): Promise<void> {
        try {
            const files = await fs.promises.readdir(folderPath);
            const imageFiles = files
                .filter(file => this.isImageFile(file))
                .sort();

            if (imageFiles.length > 0) {
                const imagePath = path.join(folderPath, imageFiles[0]);
                const uri = vscode.Uri.file(imagePath);

                // 新しいエディタで画像を開く
                await vscode.commands.executeCommand('vscode.openWith', uri, 'imageController.imageViewer');
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
        if (!this.activeWebview || this.imageFiles.length === 0) return;

        this.currentImagePath = this.imageFiles[this.currentIndex];
        const uri = vscode.Uri.file(this.currentImagePath);
        this.activeWebview.webview.html = this.getHtmlContent(uri);
    }

    /**
     * 現在の画像を削除する（確認ダイアログ付き）
     */
    async deleteImage(): Promise<void> {
        if (!this.currentImagePath) return;

        const result = await vscode.window.showWarningMessage(
            `Delete ${path.basename(this.currentImagePath)}?`,
            'Yes', 'No'
        );

        if (result === 'Yes') {
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
            }
        }
    }

    /**
     * 現在の画像のパスをクリップボードにコピーする
     */
    async copyImage(): Promise<void> {
        if (!this.currentImagePath) return;

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
        if (!this.activeWebview) return;
        this.activeWebview.webview.postMessage({ command: 'rotate' });
    }

    /**
     * 画像のズームと位置をリセットする
     */
    resetZoom(): void {
        if (!this.activeWebview) return;
        this.activeWebview.webview.postMessage({ command: 'resetZoom' });
    }

    /**
     * Webview用のHTMLコンテンツを生成する
     * @param uri 画像ファイルのURI
     * @returns HTMLコンテンツ
     */
    private getHtmlContent(uri: vscode.Uri): string {
        const webviewUri = this.activeWebview?.webview.asWebviewUri(uri);

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Controller</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #1e1e1e;
            overflow: hidden;
            position: relative;
        }
        
        #imageContainer {
            width: 100vw;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: grab;
        }
        
        #imageContainer.dragging {
            cursor: grabbing;
        }
        
        #image {
            max-width: none;
            max-height: none;
            width: auto;
            height: auto;
            transform-origin: center;
        }
        
        #toolbar {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            border-radius: 5px;
            padding: 5px;
            display: flex;
            gap: 5px;
        }
        
        .toolbar-button {
            background: #007acc;
            border: none;
            color: white;
            padding: 8px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .toolbar-button:hover {
            background: #005a9e;
        }
        
        #info {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 5px 10px;
            border-radius: 3px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div id="imageContainer">
        <img id="image" src="${webviewUri}" alt="Image">
    </div>
    
    <div id="toolbar">
        <button class="toolbar-button" onclick="sendMessage('prevImage')" title="Previous Image (Left Arrow)">◀</button>
        <button class="toolbar-button" onclick="sendMessage('nextImage')" title="Next Image (Right Arrow)">▶</button>
        <button class="toolbar-button" onclick="sendMessage('nextFolder')" title="Previous Folder (Ctrl+Up)">🔽</button>
        <button class="toolbar-button" onclick="sendMessage('prevFolder')" title="Next Folder (Ctrl+Down)">🔼</button>
        <button class="toolbar-button" onclick="sendMessage('rotateImage')" title="Rotate Image (Ctrl+R)">↻</button>
        <button class="toolbar-button" onclick="sendMessage('resetZoom')" title="Reset Zoom & Position">⌂</button>
        <button class="toolbar-button" onclick="sendMessage('copyImage')" title="Copy Image Path (Ctrl+C)">📋</button>
        <button class="toolbar-button" onclick="sendMessage('deleteImage')" title="Delete Image (Delete Key)">🗑</button>
    </div>
    
    <div id="info">
        <span id="filename">${path.basename(uri.fsPath)}</span>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let scale = 1;
        let rotation = 0;
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let imagePosition = { x: 0, y: 0 };
        
        const image = document.getElementById('image');
        const container = document.getElementById('imageContainer');
        
        function sendMessage(command) {
            vscode.postMessage({ command: command });
        }
        
        // マウスホイールでズーム
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            scale = Math.max(0.1, Math.min(10, scale + delta));
            updateTransform();
        });
        
        // マウスドラッグで画像移動
        container.addEventListener('mousedown', (e) => {
            if (e.target === image) {
                isDragging = true;
                container.classList.add('dragging');
                dragStart.x = e.clientX - imagePosition.x;
                dragStart.y = e.clientY - imagePosition.y;
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                imagePosition.x = e.clientX - dragStart.x;
                imagePosition.y = e.clientY - dragStart.y;
                updateTransform();
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
            container.classList.remove('dragging');
        });
        
        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            switch(e.key) {
                case 'ArrowRight':
                    sendMessage('nextImage');
                    break;
                case 'ArrowLeft':
                    sendMessage('prevImage');
                    break;
                case 'Delete':
                    sendMessage('deleteImage');
                    break;
            }
            
            if (e.ctrlKey) {
                switch(e.key) {
                    case 'c':
                        e.preventDefault();
                        sendMessage('copyImage');
                        break;
                    case 'r':
                        e.preventDefault();
                        sendMessage('rotateImage');
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        sendMessage('prevFolder');
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        sendMessage('nextFolder');
                        break;
                }
            }
        });
        
        function updateTransform() {
            image.style.transform = \`translate(\${imagePosition.x}px, \${imagePosition.y}px) scale(\${scale}) rotate(\${rotation}deg)\`;
        }
        
        // VS Codeからのメッセージを処理
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'rotate':
                    rotation = (rotation + 90) % 360;
                    updateTransform();
                    break;
                case 'resetZoom':
                    // 画像をフィットサイズに戻す
                    const containerWidth = container.clientWidth;
                    const containerHeight = container.clientHeight - 20; // ツールバー分を少し考慮
                    const imageWidth = image.naturalWidth;
                    const imageHeight = image.naturalHeight;
                    
                    const scaleX = (containerWidth * 0.98) / imageWidth;
                    const scaleY = (containerHeight * 0.98) / imageHeight;
                    const fitScale = Math.min(scaleX, scaleY);
                    
                    scale = fitScale;
                    rotation = 0;
                    imagePosition = { x: 0, y: 0 };
                    updateTransform();
                    break;
            }
        });
        
        // 画像読み込み完了時にフィットサイズを計算
        image.addEventListener('load', () => {
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight - 20; // ツールバー分を少し考慮
            const imageWidth = image.naturalWidth;
            const imageHeight = image.naturalHeight;
            
            // 画像をコンテナに収まるようにスケールを計算（98%を使用してほぼフル活用）
            const scaleX = (containerWidth * 0.98) / imageWidth;
            const scaleY = (containerHeight * 0.98) / imageHeight;
            const fitScale = Math.min(scaleX, scaleY);
            
            scale = fitScale;
            rotation = 0;
            imagePosition = { x: 0, y: 0 };
            updateTransform();
        });
    </script>
</body>
</html>`;
    }
}

/**
 * VS Code拡張機能の非アクティベート関数
 * 拡張機能が無効化される際に呼び出される
 */
export function deactivate() {
    console.log('Image Controller extension is now deactivated.');
}
