const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { PythonShell } = require('python-shell');
const sudo = require('sudo-prompt');
const { exec } = require('child_process');

let isAdminMode = false;

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
        runPythonCommand(
            ['disk_info'],
            (message) => resolve(message),
            (err) => reject(err),
            () => { }
        );
    });
});

// 追踪活跃的扫描进程 { path: { pyshell, startTime } }
let activeScanners = new Map();
let maxConcurrency = 3;

// 更新并发设置
ipcMain.handle('update-concurrency', (event, value) => {
    maxConcurrency = parseInt(value);
    return true;
});

// 获取当前任务状态
ipcMain.handle('get-active-tasks', () => {
    const tasks = [];
    activeScanners.forEach((value, key) => {
        tasks.push({ path: key, startTime: value.startTime });
    });
    return tasks;
});

// 取消所有活跃扫描
ipcMain.handle('cancel-scans', () => {
    activeScanners.forEach((value) => {
        try { value.pyshell.kill(); } catch (e) { }
    });
    activeScanners.clear();
    return true;
});

// 增量获取目录详情
ipcMain.handle('scan-directory', async (event, dirPath) => {
    // 权限与并发校验
    if (activeScanners.size >= maxConcurrency) {
        throw new Error('CONCURRENCY_LIMIT');
    }

    return new Promise((resolve, reject) => {
        let resolved = false;

        const session = runPythonCommand(
            ['list_dir', dirPath],
            (message) => {
                if (message.type === 'structure') {
                    if (!resolved) {
                        resolve(message);
                        resolved = true;
                    }
                }
                mainWindow.webContents.send('scan-update', { ...message, sourcePath: dirPath });
            },
            (err) => {
                if (!resolved) {
                    reject(err);
                    resolved = true;
                } else {
                    mainWindow.webContents.send('scan-update', { type: 'error', message: err.message, sourcePath: dirPath });
                }
            },
            () => {
                activeScanners.delete(dirPath);
                mainWindow.webContents.send('task-finished', dirPath);
            }
        );

        activeScanners.set(dirPath, { pyshell: session, startTime: Date.now() });
    });
});

ipcMain.handle('open-path', async (event, path) => {
    shell.openPath(path);
    return true;
});

// 管理员模式切换
ipcMain.handle('toggle-admin', async (event, enabled) => {
    isAdminMode = enabled;
    return isAdminMode;
});

/**
 * 核心：支持提权的 Python 调用
 */
function runPythonCommand(args, onMessage, onError, onExit) {
    const scriptPath = path.join(__dirname, '../backend/scanner.py');

    if (isAdminMode) {
        // 使用 sudo-prompt 运行
        // 注意：sudo-prompt 不支持流式 stdout 监听，
        // 对于长任务，我们需要通过 sudo 授权后，运行一个保持权限的命令
        const options = { name: 'Disk Space Analyzer' };
        const pythonPath = '/usr/bin/python3';
        const cmd = `"${pythonPath}" "${scriptPath}" ${args.join(' ')}`;

        console.log('Running Sudo Command:', cmd);

        sudo.exec(cmd, options, (error, stdout, stderr) => {
            if (error) {
                console.error('Sudo Execution Error:', error);
                console.error('Stderr:', stderr);
                onError(error || new Error(stderr));
                return;
            }
            if (stderr) console.warn('Sudo Stderr:', stderr);
            console.log('Sudo Stdout length:', stdout ? stdout.length : 0);

            if (stdout) {
                const lines = stdout.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const start = trimmed.indexOf('{');
                        if (start !== -1) {
                            const msg = JSON.parse(trimmed.substring(start));
                            onMessage(msg);
                        }
                    } catch (e) {
                        console.warn('Parse failed for line:', trimmed);
                    }
                }
            }
            onExit();
        });
        return { kill: () => { } }; // sudo-prompt 进程较难直接 kill
    } else {
        // 普通模式，使用 PythonShell
        let pyshell = new PythonShell(scriptPath, { mode: 'json', args });
        pyshell.on('message', onMessage);
        pyshell.on('error', onError);
        pyshell.end(onExit);
        return pyshell;
    }
}
