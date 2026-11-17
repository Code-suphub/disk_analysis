const { ipcRenderer } = require('electron');

// Language translations
const translations = {
    cn: {
        title: '磁盘空间分析器',
        selectFolder: '选择文件夹',
        minimumSize: '最小大小 (MB):',
        applyFilter: '应用过滤',
        treemapView: '树图视图',
        treeView: '明细列表',
        details: '详细信息',
        scanning: '正在扫描文件结构...',
        scanComplete: '扫描完成',
        path: '路径',
        size: '大小',
        type: '类型',
        modified: '修改时间',
        created: '创建时间',
        fileCount: '文件数量',
        error: '错误',
        free: '可用',
        used: '已用',
        total: '总量',
        taskLimitTitle: '⚠️ 任务已满',
        taskLimitMsg: '当前并发扫描任务已满 ({n}/{m})，请等待现有任务完成后再试，或在设置中调高并行数。'
    },
    en: {
        title: 'Disk Space Analyzer',
        selectFolder: 'Select Folder',
        minimumSize: 'Min Size (MB):',
        applyFilter: 'Apply Filter',
        treemapView: 'Treemap',
        treeView: 'Tree List',
        details: 'Details',
        scanning: 'Scanning structure...',
        scanComplete: 'Loaded',
        path: 'Path',
        size: 'Size',
        type: 'Type',
        modified: 'Modified',
        created: 'Created',
        fileCount: 'Files',
        error: 'Error',
        free: 'Free',
        used: 'Used',
        total: 'Total',
        taskLimitTitle: '⚠️ Tasks Full',
        taskLimitMsg: 'Concurrent scan limit reached ({n}/{m}). Please wait for current tasks to finish or increase limit in settings.'
    }
};

let currentLang = 'cn';
function t(key) { return translations[currentLang][key] || key; }

// Initialize
const chart = echarts.init(document.getElementById('treemap'));
let currentData = null;
let currentView = 'treemap';
let treemapUpdateTimer = null;
let maxConcurrency = parseInt(localStorage.getItem('maxConcurrency')) || 3;

// Utilities
// CSS 选择器安全转义 - 处理路径中的特殊字符
function escapeSelector(str) {
    if (!str) return '';
    // 转义 CSS 选择器中的特殊字符
    return str.replace(/([!"#$%&'()*+,.\/:<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function formatBytes(bytes) {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i < 0) return bytes + ' B';
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function findNode(root, path) {
    if (!root) return null;
    if (root.path === path) return root;
    if (root.children && Array.isArray(root.children)) {
        for (const child of root.children) {
            const found = findNode(child, path);
            if (found) return found;
        }
    }
    return null;
}

// Disk Management
async function loadDisks() {
    const disks = await ipcRenderer.invoke('get-disks');
    const diskList = document.getElementById('disk-list');
    diskList.innerHTML = '';

    disks.forEach(disk => {
        const card = document.createElement('div');
        card.className = 'disk-card';
        const colorClass = disk.percent > 90 ? 'danger' : (disk.percent > 75 ? 'warning' : '');

        card.innerHTML = `
            <h3>${disk.name}</h3>
            <div class="disk-info">
                <span>${t('used')}: ${formatBytes(disk.used)}</span>
                <span>${disk.percent}%</span>
            </div>
            <div class="disk-progress-bar">
                <div class="disk-progress-fill ${colorClass}" style="width: ${disk.percent}%"></div>
            </div>
            <div class="disk-info" style="margin-top: 5px">
                <span>${t('free')}: ${formatBytes(disk.free)}</span>
                <span>${t('total')}: ${formatBytes(disk.total)}</span>
            </div>
        `;

        card.onclick = () => {
            document.querySelectorAll('.disk-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            startScan(disk.path);
        };
        diskList.appendChild(card);
    });
}

// Task Sidebar UI Updates
async function updateTaskManagerUI() {
    const tasks = await ipcRenderer.invoke('get-active-tasks');
    const list = document.getElementById('activeTaskList');
    const progressContainer = document.querySelector('.progress-container');

    if (tasks.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
                <div style="font-size: 40px; margin-bottom: 10px;">☕️</div>
                <div>暂无活跃扫描任务</div>
            </div>
        `;
        // If no tasks are running, eventually hide the progress bar
        if (progressContainer.style.display !== 'none') {
            setTimeout(() => {
                ipcRenderer.invoke('get-active-tasks').then(latestTasks => {
                    if (latestTasks.length === 0) {
                        const text = document.getElementById('progress-text').textContent;
                        if (text.includes('正在') || text === t('scanning')) {
                            progressContainer.style.display = 'none';
                        }
                    }
                });
            }, 2000);
        }
        return;
    }

    list.innerHTML = '';
    tasks.forEach(task => {
        const item = document.createElement('div');
        item.className = 'task-item';
        const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
        item.innerHTML = `
            <div class="path">${task.path}</div>
            <div class="status">⚡️ 扫描中 (${elapsed}s)</div>
        `;
        list.appendChild(item);
    });
}

// Auto-refresh tasks every second when sidebar is open
setInterval(() => {
    if (document.getElementById('taskSidebar').classList.contains('open')) {
        updateTaskManagerUI();
    }
}, 1000);

// Streaming Scan Updates
ipcRenderer.on('scan-update', (event, message) => {
    const progressContainer = document.querySelector('.progress-container');
    const progressText = document.getElementById('progress-text');

    if (message.type === 'status') {
        progressContainer.style.display = 'block';
        progressText.textContent = message.message;
    } else if (message.type === 'size_update') {
        updateNodeSize(message.path, message.size);
    } else if (message.type === 'size_batch') {
        for (const [path, size] of Object.entries(message.sizes)) {
            updateNodeSize(path, size);
        }
        // 更新根目录大小（如果后端提供了 root_size）
        if (message.root_size && currentData) {
            currentData.size = message.root_size;
        }
        // 重要：在批量更新尺寸后刷新 UI，确保 Treemap 等视图同步
        updateUI();

        setTimeout(() => {
            ipcRenderer.invoke('get-active-tasks').then(tasks => {
                if (tasks.length === 0) progressContainer.style.display = 'none';
            });
        }, 1500);
    } else if (message.type === 'error') {
        progressText.textContent = t('error') + ': ' + message.message;
        setTimeout(() => { progressContainer.style.display = 'none'; }, 3000);
    }
});

ipcRenderer.on('task-finished', () => {
    updateTaskManagerUI();
});

function updateNodeSize(path, size) {
    const nodeData = findNode(currentData, path);
    if (nodeData) {
        const oldSize = nodeData.size;
        nodeData.size = size;
        nodeData.is_loaded = true;

        const escapedPath = escapeSelector(path);
        const element = document.querySelector(`.tree-node[data-path="${escapedPath}"]`);
        if (element) {
            element.classList.remove('loading');
            const sizeText = element.querySelector('.size');
            if (sizeText) {
                sizeText.textContent = formatBytes(size);
            }
            // 更新该节点的百分比条
            if (currentData.size > 0) {
                const usageFill = element.querySelector('.disk-usage-fill');
                if (usageFill) {
                    // 根节点总是 100%，其他节点根据与根目录的比例
                    const isRootNode = (path === currentData.path);
                    const percent = isRootNode ? 100 : (size / currentData.size * 100).toFixed(1);
                    usageFill.style.width = `${percent}%`;
                }
            }
        }

        // 如果是根目录被更新，需要刷新所有子节点的百分比条（因为父大小变了）
        if (path === currentData.path) {
            updateAllUsageBars();
        }

        // 更新 treemap
        if (currentView === 'treemap') {
            if (treemapUpdateTimer) clearTimeout(treemapUpdateTimer);
            treemapUpdateTimer = setTimeout(() => updateTreemap(), 500);
        }
    }
}

function updateAllUsageBars() {
    if (!currentData) return;

    const treeview = document.getElementById('treeview');
    if (!treeview) return;

    const rootSize = currentData.size;
    const hasValidRootSize = rootSize !== undefined && rootSize !== null && rootSize > 0;

    treeview.querySelectorAll('.tree-node').forEach(node => {
        const path = node.dataset.path;
        const data = findNode(currentData, path);
        if (!data) return;

        const isRootNode = (path === currentData.path);
        const fill = node.querySelector('.disk-usage-fill');
        if (!fill) return;

        // 根节点总是 100%
        if (isRootNode) {
            fill.style.width = '100%';
            return;
        }

        // 有有效大小时计算百分比
        if (hasValidRootSize && data.size !== undefined && data.size !== null) {
            const percent = ((data.size / rootSize) * 100).toFixed(1);
            fill.style.width = `${percent}%`;
        } else {
            fill.style.width = '0%';
        }
    });
}

// Scanning
async function startScan(dirPath) {
    // 1. 立即清空当前视图和数据，显示加载状态
    currentData = null;
    document.getElementById('treeview').innerHTML = '';
    chart.clear(); // 清空 treemap

    // 清除待处理展开集合
    pendingExpansions.clear();

    // 取消之前的扫描
    await ipcRenderer.invoke('cancel-scans');

    const response = await tryScan(dirPath);
    if (response) {
        currentData = {
            path: response.root,
            name: response.root.split(/[\\/]/).pop() || response.root,
            type: 'directory',
            children: response.items,
            size: response.root_size, // 后端可能直接返回根目录大小
            is_loaded: false // 大小还在计算中
        };

        // 如果后端已经返回了根目录大小（在 structure 响应中）
        if (response.root_size !== undefined && response.root_size !== null) {
            currentData.size = response.root_size;
            currentData.is_loaded = true;
        }

        updateUI();

        // 自动展开第一层（现在子节点已经渲染到 DOM 了，只需要切换展开状态）
        setTimeout(() => {
            const rootNode = document.querySelector('.tree-node.folder');
            if (rootNode) {
                rootNode.classList.add('expanded');
                const button = rootNode.querySelector('.expand-button');
                if (button) button.textContent = '▼';
            }
        }, 300);
    }
}

async function tryScan(path) {
    const progressContainer = document.querySelector('.progress-container');
    const progressText = document.getElementById('progress-text');

    // 如果开启了管理员模式，给出明确的授权等待提示
    if (adminModeCheckbox.checked) {
        progressContainer.style.display = 'block';
        progressText.textContent = '🔒 正在请求系统授权，请在弹窗中输入密码...';
    }

    try {
        const result = await ipcRenderer.invoke('scan-directory', path);
        updateTaskManagerUI();
        // 关键：在收到结构结果后，如果是同步返回（如管理员模式），立即刷新一次 UI
        updateUI();
        return result;
    } catch (err) {
        if (err.message.includes('CONCURRENCY_LIMIT')) {
            showLimitModal();
        } else {
            console.error(err);
            progressText.textContent = '❌ 扫描失败: ' + err.message;
            setTimeout(() => { progressContainer.style.display = 'none'; }, 3000);
        }
        return null;
    }
}

function showLimitModal() {
    const overlay = document.getElementById('modalOverlay');
    const msg = document.getElementById('modalMessage');
    ipcRenderer.invoke('get-active-tasks').then(tasks => {
        msg.textContent = t('taskLimitMsg').replace('{n}', tasks.length).replace('{m}', maxConcurrency);
        overlay.style.display = 'flex';
    });
}

// 正在进行的展开操作跟踪，防止重复点击
const pendingExpansions = new Set();

async function expandFolder(path, nodeElement, forceRefresh = false) {
    const button = nodeElement.querySelector('.expand-button');
    const childrenContainer = nodeElement.querySelector('.children');
    const nodeData = findNode(currentData, path);

    // 如果不是强制刷新，且 DOM 中已有子元素，则只切换显隐
    const hasChildrenInDOM = childrenContainer && childrenContainer.children.length > 0;
    if (!forceRefresh && hasChildrenInDOM) {
        if (nodeElement.classList.contains('expanded')) {
            nodeElement.classList.remove('expanded');
            button.textContent = '▶';
        } else {
            nodeElement.classList.add('expanded');
            button.textContent = '▼';
        }
        return;
    }

    // 防止重复点击同一文件夹
    if (pendingExpansions.has(path)) {
        console.log('Expansion already in progress for:', path);
        return;
    }

    pendingExpansions.add(path);

    try {
        // 执行扫描展开逻辑
        nodeElement.classList.add('expanded');
        button.textContent = '...';

        const freshData = await tryScan(path);
        if (freshData) {
            if (nodeData) {
                nodeData.children = freshData.items;
                nodeData.is_loaded = true;
            }
            childrenContainer.innerHTML = '';
            freshData.items.sort((a, b) => (b.size || 0) - (a.size || 0)).forEach(child => {
                // 使用父节点（当前展开的节点）的大小来计算百分比
                const parentSize = nodeData ? (nodeData.size || 0) : 0;
                childrenContainer.appendChild(createTreeNode(child, parentSize));
            });
            button.textContent = '▼';
        } else {
            // 扫描失败，恢复状态
            button.textContent = '▶';
            nodeElement.classList.remove('expanded');
        }
    } finally {
        pendingExpansions.delete(path);
    }
}

function createTreeNode(node, parentSize) {
    const div = document.createElement('div');
    div.className = `tree-node ${node.type === 'directory' ? 'folder' : 'file'}`;
    // 文件夹只有在未加载大小时才显示 loading 状态
    if (node.type === 'directory' && (!node.is_loaded || node.size === undefined || node.size === null)) {
        div.classList.add('loading');
    }
    div.dataset.path = node.path;
    // 对于文件，使用已知的 size；对于文件夹，如果已加载则使用，否则显示 "计算中..."
    let nodeSize = 0;
    let sizeDisplay = '';

    if (node.type === 'file') {
        nodeSize = node.size || 0;
        sizeDisplay = formatBytes(nodeSize);
    } else {
        // 文件夹
        if (node.is_loaded && node.size !== undefined && node.size !== null) {
            nodeSize = node.size;
            sizeDisplay = formatBytes(nodeSize);
        } else {
            sizeDisplay = '计算中...';
        }
    }

    // 如果是根节点（没有 parent 或 parent 就是自身），百分比应该基于自身
    const isRootNode = !parentSize || parentSize === nodeSize;
    const percent = isRootNode ? 100 : (parentSize > 0 ? ((nodeSize / parentSize) * 100).toFixed(1) : 0);

    div.innerHTML = `
        <div class="tree-node-content">
            <span class="expand-button">${node.type === 'directory' ? '▶' : '&nbsp;'}</span>
            <span class="icon">${node.type === 'directory' ? '📁' : '📄'}</span>
            <div class="content">
                <div class="name-container"><span class="name">${node.name}</span></div>
                <span class="size">${sizeDisplay}</span>
                <div class="disk-usage-bar"><div class="disk-usage-fill" style="width: ${percent}%"></div></div>
            </div>
        </div>
        <div class="children"></div>
    `;

    const content = div.querySelector('.content');
    content.onclick = (e) => {
        e.stopPropagation();
        updateDetails(node);
        if (node.type === 'directory') expandFolder(node.path, div);
    };

    // 右键动作处理
    div.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, node, div);
    };

    if (node.type === 'directory') {
        div.querySelector('.expand-button').onclick = (e) => {
            e.stopPropagation();
            expandFolder(node.path, div);
        };
    }
    return div;
}

// UI Update Functions
function updateUI() {
    if (!currentData) return;

    // 根据当前视图更新
    if (currentView === 'treemap') {
        updateTreemap();
    } else {
        updateTreeView();
    }
}

function updateTreemap() {
    if (!currentData) return;

    // 转换数据为 ECharts treemap 格式
    function convertToTreemapData(node, parentPath = '') {
        const path = node.path || parentPath + '/' + node.name;
        const item = {
            name: node.name,
            path: path,
            value: node.size || 0,
            itemStyle: {
                color: node.type === 'directory' ? undefined : '#10b981'
            }
        };

        if (node.children && node.children.length > 0) {
            item.children = node.children
                .filter(child => child.size > 0)
                .map(child => convertToTreemapData(child, path));
        }

        return item;
    }

    const option = {
        title: {
            text: currentData.name,
            left: 'center'
        },
        tooltip: {
            formatter: function(info) {
                const value = info.value;
                const name = info.name;
                return `<div style="padding: 10px;">
                    <strong>${name}</strong><br/>
                    ${formatBytes(value)}
                </div>`;
            }
        },
        series: [{
            type: 'treemap',
            width: '100%',
            height: '90%',
            roam: false,
            nodeClick: false,
            breadcrumb: {
                show: true,
                top: 'bottom'
            },
            itemStyle: {
                borderColor: '#fff',
                borderWidth: 1,
                gapWidth: 1
            },
            data: [convertToTreemapData(currentData)]
        }]
    };

    chart.setOption(option);

    // 添加点击事件
    chart.off('click');
    chart.on('click', function(params) {
        const node = findNode(currentData, params.data.path);
        if (node) {
            updateDetails(node);
            // 如果在树形视图中存在，展开它
            const treeNode = document.querySelector(`.tree-node[data-path="${escapeSelector(params.data.path)}"]`);
            if (treeNode && node.type === 'directory') {
                expandFolder(node.path, treeNode);
            }
        }
    });
}

function updateTreeView() {
    if (!currentData) return;

    const treeview = document.getElementById('treeview');
    if (treeview.innerHTML === '') {
        // 首次渲染 - 渲染根节点
        treeview.innerHTML = '';
        // 根节点的 parentSize 传 0，它会自己处理为 100% 或计算中
        const rootNode = createTreeNode(currentData, 0);
        treeview.appendChild(rootNode);

        // 如果有子节点数据，自动渲染第一层（但不展开）
        if (currentData.children && currentData.children.length > 0) {
            const childrenContainer = rootNode.querySelector('.children');
            // 子节点排序：已加载大小的按大小排序，未加载的放在后面
            const sortedChildren = [...currentData.children].sort((a, b) => {
                // 如果都没加载，保持原始顺序
                if ((!a.is_loaded && a.size === undefined) && (!b.is_loaded && b.size === undefined)) return 0;
                // 已加载的排在前面，按大小降序
                if (a.is_loaded && !b.is_loaded) return -1;
                if (!a.is_loaded && b.is_loaded) return 1;
                // 都已加载，按大小降序
                return (b.size || 0) - (a.size || 0);
            });
            sortedChildren.forEach(child => {
                // 子节点使用根节点的大小作为 parentSize（等根节点大小加载后再更新）
                childrenContainer.appendChild(createTreeNode(child, currentData.size || 0));
            });
        }
    } else {
        // 更新已有节点的大小显示
        updateAllUsageBars();
    }
}

function updateDetails(node) {
    const detailsContainer = document.getElementById('selected-item-details');
    if (!node) {
        detailsContainer.innerHTML = '<p>点击项目查看详情</p>';
        return;
    }

    const size = node.size !== undefined && node.size !== null ? formatBytes(node.size) : '计算中...';

    detailsContainer.innerHTML = `
        <div style="margin-bottom: 15px;">
            <strong>${t('path')}:</strong><br/>
            <span style="word-break: break-all;">${node.path}</span>
        </div>
        <div style="margin-bottom: 15px;">
            <strong>${t('type')}:</strong> ${node.type === 'directory' ? '文件夹' : '文件'}
        </div>
        <div style="margin-bottom: 15px;">
            <strong>${t('size')}:</strong> ${size}
        </div>
        ${node.children ? `
        <div style="margin-bottom: 15px;">
            <strong>子项目数:</strong> ${node.children.length}
        </div>
        ` : ''}
    `;
}

// Context Menu Logic
let currentContextNode = null;
let currentContextElement = null;

function showContextMenu(x, y, node, element) {
    const menu = document.getElementById('context-menu');
    currentContextNode = node;
    currentContextElement = element;

    menu.style.display = 'block';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // 针对文件，隐藏“刷新”选项
    document.getElementById('menu-refresh').style.display = node.type === 'directory' ? 'block' : 'none';
}

document.addEventListener('click', () => {
    document.getElementById('context-menu').style.display = 'none';
});

document.getElementById('menu-refresh').onclick = () => {
    if (currentContextNode && currentContextElement) {
        expandFolder(currentContextNode.path, currentContextElement, true);
    }
};

document.getElementById('menu-open').onclick = () => {
    if (currentContextNode) {
        ipcRenderer.invoke('open-path', currentContextNode.path);
    }
};

function switchView(mode) {
    currentView = mode;
    document.getElementById('treemapView').classList.toggle('active', mode === 'treemap');
    document.getElementById('treeView').classList.toggle('active', mode === 'tree');
    document.getElementById('treemap').style.display = mode === 'treemap' ? 'block' : 'none';
    document.getElementById('treeview').style.display = mode === 'tree' ? 'block' : 'none';
    if (mode === 'treemap') chart.resize();
    updateUI();
}

// Events
document.getElementById('selectFolder').onclick = async () => {
    const path = await ipcRenderer.invoke('select-directory');
    if (path) startScan(path);
};

document.getElementById('taskToggle').onclick = () => {
    document.getElementById('taskSidebar').classList.add('open');
};

document.getElementById('closeSidebar').onclick = () => {
    document.getElementById('taskSidebar').classList.remove('open');
};

const concurrencyRange = document.getElementById('concurrencyRange');
const concurrencyValue = document.getElementById('concurrencyValue');

// Initialize settings
concurrencyRange.value = maxConcurrency;
concurrencyValue.textContent = maxConcurrency;
ipcRenderer.invoke('update-concurrency', maxConcurrency);

concurrencyRange.oninput = () => {
    const val = concurrencyRange.value;
    concurrencyValue.textContent = val;
    maxConcurrency = parseInt(val);
    localStorage.setItem('maxConcurrency', val);
    ipcRenderer.invoke('update-concurrency', val);
};

document.getElementById('treemapView').onclick = () => switchView('treemap');
document.getElementById('treeView').onclick = () => switchView('tree');
document.getElementById('applyFilter').onclick = () => updateUI();
window.onresize = () => chart.resize();

// 管理员模式
const adminModeCheckbox = document.getElementById('adminMode');
const adminToggleContainer = document.getElementById('adminToggleContainer');
const adminText = document.getElementById('adminText');

adminModeCheckbox.onchange = async () => {
    const isChecked = adminModeCheckbox.checked;
    await ipcRenderer.invoke('toggle-admin', isChecked);

    if (isChecked) {
        adminToggleContainer.classList.add('active');
        adminText.textContent = '🔓 已开启管理员模式（仅系统目录需要）';
    } else {
        adminToggleContainer.classList.remove('active');
        adminText.textContent = '🔒 管理员模式（扫描用户数据无需开启）';
    }

    // 切换模式后建议刷新磁盘列表
    loadDisks();
};

document.getElementById('languageSwitch').onclick = () => {
    currentLang = currentLang === 'cn' ? 'en' : 'cn';
    document.getElementById('languageSwitch').classList.toggle('en', currentLang === 'en');
    document.querySelector('h1').textContent = t('title');
    document.getElementById('selectFolder').textContent = t('selectFolder');
    document.getElementById('treemapView').textContent = t('treemapView');
    document.getElementById('treeView').textContent = t('treeView');
    adminText.textContent = currentLang === 'cn' ?
        (adminModeCheckbox.checked ? '🔓 已开启管理员模式' : '🔒 管理员模式') :
        (adminModeCheckbox.checked ? '🔓 Admin Mode Active' : '🔒 Admin Mode');
    loadDisks();
    if (currentData) updateUI();
};

// Start
switchView('treemap');
loadDisks();
updateTaskManagerUI();
