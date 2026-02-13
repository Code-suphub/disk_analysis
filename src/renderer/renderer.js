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
        modified: '修改时间',
        created: '创建时间',
        fileCount: '文件数量',
        error: '错误',
        free: '可用',
        used: '已用',
        total: '总量'
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
        modified: 'Modified',
        created: 'Created',
        fileCount: 'Files',
        error: 'Error',
        free: 'Free',
        used: 'Used',
        total: 'Total'
    }
};

let currentLang = 'cn';
function t(key) { return translations[currentLang][key] || key; }

// Initialize ECharts
const chart = echarts.init(document.getElementById('treemap'));
let currentData = null;
let currentView = 'treemap';
let treemapUpdateTimer = null;

// Utilities
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
        // After batch update, wait a bit then hide
        setTimeout(() => {
            if (progressText.textContent.includes('计算')) progressContainer.style.display = 'none';
        }, 1500);
    } else if (message.type === 'error') {
        progressText.textContent = t('error') + ': ' + message.message;
        setTimeout(() => { progressContainer.style.display = 'none'; }, 3000);
    }
});

function updateNodeSize(path, size) {
    const nodeData = findNode(currentData, path);
    if (nodeData) {
        nodeData.size = size;
        nodeData.is_loaded = true;

        // Update DOM if it exists
        const escapedPath = path.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
        const element = document.querySelector(`.tree-node[data-path="${escapedPath}"]`);
        if (element) {
            const sizeText = element.querySelector('.size');
            if (sizeText) {
                sizeText.textContent = formatBytes(size);
                element.classList.remove('loading');
            }

            // Update usage bar for this item locally
            const usageFill = element.querySelector('.disk-usage-fill');
            if (usageFill && currentData.size > 0) {
                usageFill.style.width = `${(size / currentData.size * 100).toFixed(1)}%`;
            }
        }

        // If this is the root being updated, we should refresh usage bars of all top-level children
        if (path === currentData.path) {
            updateAllUsageBars();
        }

        // Debounced treemap update
        if (currentView === 'treemap') {
            if (treemapUpdateTimer) clearTimeout(treemapUpdateTimer);
            treemapUpdateTimer = setTimeout(() => updateTreemap(), 500);
        }
    }
}

function updateAllUsageBars() {
    if (!currentData || !currentData.size) return;
    const treeview = document.getElementById('treeview');
    const nodes = treeview.querySelectorAll('.tree-node');
    nodes.forEach(node => {
        const path = node.dataset.path;
        const data = findNode(currentData, path);
        if (data) {
            const fill = node.querySelector('.disk-usage-fill');
            if (fill) fill.style.width = `${(data.size / currentData.size * 100).toFixed(1)}%`;
        }
    });
}

// Scanning
async function startScan(dirPath) {
    const progressContainer = document.querySelector('.progress-container');
    progressContainer.style.display = 'block';
    document.getElementById('progress-text').textContent = t('scanning');

    try {
        const response = await ipcRenderer.invoke('scan-directory', dirPath);
        currentData = {
            path: response.root,
            name: response.root.split(/[\\/]/).pop() || response.root,
            type: 'directory',
            children: response.items,
            size: 0,
            is_loaded: false
        };
        updateUI();
    } catch (err) {
        console.error(err);
        document.getElementById('progress-text').textContent = t('error') + ': ' + err.message;
    }
}

async function expandFolder(path, nodeElement) {
    const button = nodeElement.querySelector('.expand-button');
    const childrenContainer = nodeElement.querySelector('.children');

    if (nodeElement.classList.contains('expanded')) {
        nodeElement.classList.remove('expanded');
        button.textContent = '▶';
        return;
    }

    // Toggle expanded state immediately if we have content or are loading
    nodeElement.classList.add('expanded');
    button.textContent = '▼';

    if (childrenContainer.innerHTML === '') {
        button.textContent = '...';
        try {
            const freshData = await ipcRenderer.invoke('scan-directory', path);
            const nodeData = findNode(currentData, path);
            if (nodeData) {
                nodeData.children = freshData.items;
                nodeData.is_loaded = true;
            }

            if (freshData.items && freshData.items.length > 0) {
                childrenContainer.innerHTML = '';
                freshData.items.forEach(child => {
                    childrenContainer.appendChild(createTreeNode(child, nodeData ? nodeData.size : 0));
                });
            } else {
                childrenContainer.innerHTML = '<div style="padding-left: 20px; color: #94a3b8; font-size: 12px;">(空)</div>';
            }
        } catch (err) {
            console.error(err);
            childrenContainer.innerHTML = `<div style="padding-left: 20px; color: #ef4444; font-size: 12px;">Error</div>`;
        } finally {
            button.textContent = '▼';
        }
    }
}

function updateUI() {
    if (currentView === 'treemap') {
        updateTreemap();
    } else {
        updateTreeView();
    }
}

function updateTreemap() {
    if (!currentData) return;
    const minSize = parseFloat(document.getElementById('sizeFilter').value) || 0;

    function processNode(node) {
        const item = { name: node.name, path: node.path, value: node.size || 0, children: [] };
        if (node.children) {
            node.children.forEach(child => {
                const s = child.size || 0;
                if (s >= minSize * 1024 * 1024) {
                    item.children.push(processNode(child));
                }
            });
        }
        return item;
    }

    const mapData = processNode(currentData);
    chart.setOption({
        tooltip: { formatter: info => `${info.name}<br/>Size: ${formatBytes(info.value)}` },
        series: [{
            type: 'treemap',
            data: [mapData],
            breadcrumb: { show: true },
            label: { show: true, formatter: p => `${p.name}\n${formatBytes(p.value)}` }
        }]
    });
}

function createTreeNode(node, parentSize) {
    const div = document.createElement('div');
    div.className = `tree-node ${node.type === 'directory' ? 'folder' : 'file'}`;
    if (node.type === 'directory' && !node.is_loaded) div.classList.add('loading');
    div.dataset.path = node.path;

    const nodeSize = node.size || 0;
    const pSize = parentSize || 0;
    const percent = pSize > 0 ? ((nodeSize / pSize) * 100).toFixed(1) : 0;

    div.innerHTML = `
        <div class="tree-node-content">
            <span class="expand-button">${node.type === 'directory' ? '▶' : '&nbsp;'}</span>
            <span class="icon">${node.type === 'directory' ? '📁' : '📄'}</span>
            <div class="content">
                <div class="name-container"><span class="name">${node.name}</span></div>
                <span class="size">${formatBytes(nodeSize)}</span>
                <div class="disk-usage-bar"><div class="disk-usage-fill" style="width: ${percent}%"></div></div>
            </div>
        </div>
        <div class="children"></div>
    `;

    const content = div.querySelector('.content');
    content.onclick = (e) => {
        e.stopPropagation();
        updateDetails(node);
        // Single click on row to expand folder
        if (node.type === 'directory') {
            expandFolder(node.path, div);
        }
    };

    if (node.type === 'directory') {
        div.querySelector('.expand-button').onclick = (e) => {
            e.stopPropagation();
            expandFolder(node.path, div);
        };
    }

    return div;
}

function updateTreeView() {
    const treeview = document.getElementById('treeview');
    treeview.innerHTML = '';
    if (currentData) {
        treeview.appendChild(createTreeNode(currentData, currentData.size));
    }
}

function updateDetails(node) {
    const detailsDiv = document.getElementById('selected-item-details');
    detailsDiv.innerHTML = `
        <h3>${node.name}</h3>
        <p><strong>${t('path')}:</strong> ${node.path}</p>
        <p><strong>${t('size')}:</strong> ${formatBytes(node.size)}</p>
    `;
}

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

document.getElementById('treemapView').onclick = () => switchView('treemap');
document.getElementById('treeView').onclick = () => switchView('tree');
document.getElementById('applyFilter').onclick = () => updateUI();
window.onresize = () => chart.resize();

document.getElementById('languageSwitch').onclick = () => {
    currentLang = currentLang === 'cn' ? 'en' : 'cn';
    document.getElementById('languageSwitch').classList.toggle('en', currentLang === 'en');
    document.querySelector('h1').textContent = t('title');
    document.getElementById('selectFolder').textContent = t('selectFolder');
    document.getElementById('treemapView').textContent = t('treemapView');
    document.getElementById('treeView').textContent = t('treeView');
    loadDisks();
    if (currentData) updateUI();
};

// Start
switchView('treemap');
loadDisks();
