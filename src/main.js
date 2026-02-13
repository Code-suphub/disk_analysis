const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { PythonShell } = require('python-shell');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // Open DevTools in development
    if (process.argv.includes('--debug')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle folder selection
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.filePaths[0];
});

// 获取磁盘概览信息
ipcMain.handle('get-disks', async () => {
    return new Promise((resolve, reject) => {
        let pyshell = new PythonShell(path.join(__dirname, '../backend/scanner.py'), {
            mode: 'json',
            args: ['disk_info']
        });

        pyshell.on('message', (message) => {
            resolve(message);
        });

        pyshell.on('error', (err) => {
            reject(err);
        });

        pyshell.end((err) => {
            if (err) console.error('Pyshell end error:', err);
        });
    });
});

// 增量获取目录详情
ipcMain.handle('scan-directory', async (event, dirPath) => {
    return new Promise((resolve, reject) => {
        let pyshell = new PythonShell(path.join(__dirname, '../backend/scanner.py'), {
            mode: 'json',
            args: ['list_dir', dirPath]
        });

        let resolved = false;

        pyshell.on('message', (message) => {
            if (message.type === 'structure') {
                // 收到结构后即认为请求成功
                if (!resolved) {
                    resolve(message);
                    resolved = true;
                }
            }
            // 转发所有后续消息（大小更新、状态等）到渲染进程
            mainWindow.webContents.send('scan-update', message);
        });

        pyshell.on('error', (err) => {
            if (!resolved) {
                reject(err);
                resolved = true;
            } else {
                mainWindow.webContents.send('scan-update', { type: 'error', message: err.message });
            }
        });

        pyshell.end((err) => {
            if (err && !resolved) reject(err);
        });
    });
});
