import init, { generate_fingerprint_hash } from './board-wasm/pkg/board_wasm.js';
import { initBoard, renderBoardUI, createThread, compressImage } from './board.js';

const projects = [
    { title: "ノベルクリエイト", desc: "ブラウザ完結のノベルゲーム制作エンジン。HTML1つで動作。", link: "https://kkkkk-a.github.io/novel-create/", tags: ["Tool", "Engine"] },
    { title: "スプライトキャンバス", desc: "ドット絵＆アニメーション制作ツール。JSON連携対応。", link: "https://kkkkk-a.github.io/sprite-canvas/", tags: ["Tool", "PixelArt"] },
    { title: "セルランナー", desc: "描いたドット絵が性能になるラン＆アクションゲーム。", link: "https://kkkkk-a.github.io/cell-runner/", tags: ["Game"] },
    { title: "オーディオシンセ", desc: "多機能シンセサイザー＆ドラムシーケンサー。", link: "https://kkkkk-a.github.io/audio-synth/", tags: ["Tool", "Audio"] },
    { title: "メディアコンバータ", desc: "超軽量メディア変換ツール。画像・動画・音声対応。", link: "https://kkkkk-a.github.io/media-converter/", tags: ["Tool"] },
    { title: "プレイスカルプト", desc: "ブラウザ3Dスカルプト＆モデリングツール。", link: "https://kkkkk-a.github.io/play-sculpture/", tags: ["Tool", "3D"] },
    { title: "分子運動シミュレーション", desc: "インタラクティブなパーティクル物理シミュレータ。", link: "https://kkkkk-a.github.io/particle-motion-test/", tags: ["Visual"] },
    { title: "ミニゲームズ", desc: "手軽に遊べるミニゲームコレクション。", link: "https://kkkkk-a.github.io/mini-games/", tags: ["Game", "Casual"] }
];

let fpId = 'anonymous';
let currentProjectFilter = 'All';

// GPU（レンダラー）情報の取得
function getGpuInfo() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return 'no-webgl';
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        return debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'generic-gpu';
    } catch(e) {
        return 'no-gpu-info';
    }
}

async function start() {
    await init();
    
    // CPUコア数、メモリ容量、GPU、タイムゾーン、言語、画面解像度を統合
    const hardwareProfile = [
        navigator.userAgent,
        screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
        navigator.hardwareConcurrency || 'cpu-cores-unknown', // CPU論理コア数
        navigator.deviceMemory || 'memory-unknown',           // 実装メモリ(GB)
        Intl.DateTimeFormat().resolvedOptions().timeZone,    // タイムゾーン (Asia/Tokyo 等)
        navigator.language,                                  // 言語環境
        getGpuInfo()                                         // GPUモデル名
    ].join('###');

    fpId = generate_fingerprint_hash(hardwareProfile);
    localStorage.setItem('_fp_id', fpId);
    document.getElementById('display-fp').textContent = '#' + fpId;

    setupNavigation();
    setupProjectFilters();
    renderProjects();
    setupBoardSearchEvents();
    await initBoard(fpId);
    setupBoardForm();
}

function setupNavigation() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            
            const target = btn.dataset.target;
            btn.classList.add('active');
            document.getElementById(target).style.display = 'block';

            // ヘッダー検索コントロールの切り替え
            document.getElementById('controls-projects').style.display = target === 'tab-projects' ? 'flex' : 'none';
            document.getElementById('controls-board').style.display = target === 'tab-board' ? 'flex' : 'none';
            document.getElementById('controls-create').style.display = target === 'tab-create' ? 'flex' : 'none';
        };
    });
}

function setupProjectFilters() {
    const allTags = new Set();
    projects.forEach(p => p.tags.forEach(t => allTags.add(t)));
    const tags = ['All', ...Array.from(allTags)];
    const filterContainer = document.getElementById('project-filter-container');

    filterContainer.innerHTML = tags.map(tag => `
        <button class="filter-btn ${tag === 'All' ? 'active' : ''}" data-tag="${tag}">${tag}</button>
    `).join('');

    filterContainer.onclick = (e) => {
        if (!e.target.classList.contains('filter-btn')) return;
        filterContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentProjectFilter = e.target.dataset.tag;
        renderProjects();
    };

    document.getElementById('project-search-input').oninput = renderProjects;
}

function setupBoardSearchEvents() {
    document.getElementById('board-title-search').oninput = () => renderBoardUI(fpId);
    document.getElementById('board-body-search').oninput = () => renderBoardUI(fpId);
    document.getElementById('board-reply-search').oninput = () => renderBoardUI(fpId);
    document.getElementById('board-tag-search').oninput = () => renderBoardUI(fpId);
    document.getElementById('filter-has-image').onchange = () => renderBoardUI(fpId);
    document.getElementById('filter-has-reply').onchange = () => renderBoardUI(fpId);

    // 画像検索用イベント
    const searchImgInput = document.getElementById('search-image-file');
    searchImgInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const base64 = await compressImage(file, 100, 0.5);
        window._currentSearchImage = base64;

        document.getElementById('search-img-name').textContent = file.name;
        document.getElementById('search-img-preview-box').style.display = 'block';
        renderBoardUI(fpId);
    };

    document.getElementById('clear-search-img').onclick = () => {
        searchImgInput.value = '';
        window._currentSearchImage = null;
        document.getElementById('search-img-preview-box').style.display = 'none';
        renderBoardUI(fpId);
    };
}

function renderProjects() {
    const query = document.getElementById('project-search-input').value.toLowerCase().trim();
    const grid = document.getElementById('project-grid');

    const filtered = projects.filter(p => {
        const matchTag = currentProjectFilter === 'All' || p.tags.includes(currentProjectFilter);
        const matchQ = !query || p.title.toLowerCase().includes(query) || p.desc.toLowerCase().includes(query);
        return matchTag && matchQ;
    });

    grid.innerHTML = filtered.map(p => `
        <a href="${p.link}" target="_blank" rel="noopener noreferrer" class="card">
            <div class="card-banner">
                <div class="card-icon-box">
                    <img src="${p.link.replace(/\/$/, '')}/icon.png" 
                         class="card-icon" 
                         onerror="this.src='${p.link.replace(/\/$/, '')}/favicon.ico'; this.onerror=()=>{this.style.display='none'; this.nextElementSibling.style.display='block';}">
                    <span style="display:none; color:var(--accent); font-weight:bold; font-size:1.2rem;">${p.title[0]}</span>
                </div>
            </div>
            <div class="card-body">
                <div>${p.tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}</div>
                <h3 style="margin:8px 0 4px; color:#fff; font-size:1.15rem;">${p.title}</h3>
                <p style="font-size:0.85rem; color:var(--sub); margin:0;">${p.desc}</p>
            </div>
        </a>
    `).join('');
}

function setupBoardForm() {
    const form = document.getElementById('thread-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-submit');
        const title = document.getElementById('thread-title').value.trim();
        const author = document.getElementById('thread-author').value.trim();
        const body = document.getElementById('thread-body').value.trim();
        const file = document.getElementById('thread-file').files[0];

        if (!title || !body) return;
        btn.disabled = true;
        btn.textContent = '計算中...';

        await createThread(title, author, body, file, fpId);

        form.reset();
        btn.disabled = false;
        btn.textContent = 'スレッドを立てる';

        // 投稿完了後に自動で掲示板一覧タブへ切り替え
        const boardTabBtn = document.querySelector('.tab-btn[data-target="tab-board"]');
        if (boardTabBtn) {
            boardTabBtn.click();
        }
    };
}

start();