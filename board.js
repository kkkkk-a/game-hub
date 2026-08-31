import { generate_fingerprint_hash, solve_pow, roll_dice, check_moderation_status } from './board-wasm/pkg/board_wasm.js';

const SUPABASE_URL = 'https://pxwpzergezbdrltolkry.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1y7K1Z0c1PuzVpkcFgi25w_fvYxyCEN';

const isSupabaseConfigured = SUPABASE_URL.indexOf('YOUR_PROJECT_ID') === -1;
let supabase = null;
if (isSupabaseConfigured && window.supabase) {
    try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch(e) {
        console.error("Supabase初期化失敗: サーバーに接続できません", e);
    }
}

let cachedThreads = [];
let currentTag = 'All';

export function linkify(text) {
    // &quot; や &gt; などのHTMLエンティティや末尾の不要な句読点を巻き込まない正規表現
    const urlPattern = /(https?:\/\/[^\s<>"'&]+)/g;
    return text.replace(urlPattern, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

export async function compressImage(file, max = 400, quality = 0.6) {
    if (!file) return null;
    return new Promise((resolve) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.src = objUrl;
        img.onload = () => {
            URL.revokeObjectURL(objUrl);
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > max || h > max) {
                if (w > h) {
                    h = Math.round((h * max) / w);
                    w = max;
                } else {
                    w = Math.round((w * max) / h);
                    h = max;
                }
            }
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/webp', quality));
        };
        img.onerror = () => {
            URL.revokeObjectURL(objUrl);
            resolve(null);
        };
    });
}

let realtimeChannel = null;

export async function initBoard(fpId) {
    await fetchAndRender(fpId);

    if (supabase) {
        if (realtimeChannel) {
            supabase.removeChannel(realtimeChannel);
        }
        realtimeChannel = supabase
            .channel('public:threads')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => {
                fetchAndRender(fpId);
            })
            .subscribe();
    }
}

export async function fetchAndRender(fpId) {
    if (supabase) {
        const { data, error } = await supabase
            .from('threads')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(60);

        if (!error && data) {
            cachedThreads = data;
        } else if (error) {
            console.error("スレッド取得エラー:", error);
        }
    } else {
        console.error("Supabaseが初期化されていません。");
        cachedThreads = [];
    }

    renderBoardUI(fpId);
}
// 高度マルチ検索 & 描画
export function renderBoardUI(fpId) {
    const listEl = document.getElementById('thread-list');
    const tagsContainer = document.getElementById('board-tags');
    const myVotes = JSON.parse(localStorage.getItem('hub_my_votes') || '{}');

    // 検索条件の取得
    const titleQuery = document.getElementById('board-title-search')?.value.toLowerCase().trim() || '';
    const bodyQuery = document.getElementById('board-body-search')?.value.toLowerCase().trim() || '';
    const replyQuery = document.getElementById('board-reply-search')?.value.toLowerCase().trim() || '';
    const tagQuery = document.getElementById('board-tag-search')?.value.toLowerCase().trim() || '';
    
    const filterHasImg = document.getElementById('filter-has-image')?.checked;
    const filterHasReply = document.getElementById('filter-has-reply')?.checked;

    // タグ集計
    const tagCount = { 'All': cachedThreads.length };
    cachedThreads.forEach(t => {
        t.tags?.forEach(tag => tagCount[tag] = (tagCount[tag] || 0) + 1);
    });

    tagsContainer.innerHTML = Object.keys(tagCount).map(tag => `
        <button class="filter-btn ${currentTag === tag ? 'active' : ''}" data-tag="${tag}">
            #${tag} (${tagCount[tag]})
        </button>
    `).join('');

    tagsContainer.onclick = (e) => {
        if (!e.target.classList.contains('filter-btn')) return;
        currentTag = e.target.dataset.tag;
        renderBoardUI(fpId);
    };

    // 複合フィルター判定
    const filtered = cachedThreads.filter(t => {
        const matchTagButton = currentTag === 'All' || (t.tags && t.tags.includes(currentTag));
        let matchTagInput = true;
        if (tagQuery) {
            matchTagInput = (t.tags || []).some(tag => tag.toLowerCase().includes(tagQuery));
        }
        const matchTag = matchTagButton && matchTagInput;

        const matchImg = !filterHasImg || !!t.img;
        const matchReply = !filterHasReply || (t.replies && t.replies.length > 0);

        // 画像逆引き検索判定
        let matchSearchImg = true;
        if (window._currentSearchImage) {
            matchSearchImg = Boolean(t.img && t.img === window._currentSearchImage);
        }

        // 1. スレタイ個別検索
        let matchTitle = true;
        if (titleQuery) {
            matchTitle = (t.title || '').toLowerCase().includes(titleQuery);
        }

        // 2. 本文個別検索
        let matchBody = true;
        if (bodyQuery) {
            matchBody = (t.body || '').toLowerCase().includes(bodyQuery) || (t.author || '').toLowerCase().includes(bodyQuery);
        }

        // 3. レス個別検索
        let matchReplyText = true;
        if (replyQuery) {
            matchReplyText = (t.replies || []).some(r => (r.body || '').toLowerCase().includes(replyQuery) || (r.a || '').toLowerCase().includes(replyQuery));
        }

        return matchTag && matchImg && matchReply && matchSearchImg && matchTitle && matchBody && matchReplyText;
    });

    if (filtered.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;color:var(--sub);padding:30px;">一致するスレッドがありません。</div>`;
        return;
    }

    // 【フォーカスモード対応】選択されたスレッドだけを大きく表示し、他のスレッドを隠す仕組み
    if (!window._expandedThreadId) window._expandedThreadId = null;
    let displayThreads = filtered;
    const isFocusMode = window._expandedThreadId !== null;
    if (isFocusMode) {
        const targetThread = filtered.find(t => t.id === window._expandedThreadId);
        if (targetThread) {
            displayThreads = [targetThread]; // 選択された1件だけに絞る
        } else {
            window._expandedThreadId = null;
        }
    }

    listEl.className = isFocusMode ? 'thread-single-view' : 'thread-grid';

    listEl.innerHTML = `
        ${isFocusMode ? `
            <div style="margin-bottom: 14px;">
                <button class="btn-sub-action" onclick="toggleThread(null)" style="padding: 7px 16px; font-size: 0.85rem; display:inline-flex; align-items:center; gap:6px;">
                    <span>←</span> スレッド一覧に戻る
                </button>
            </div>
        ` : ''}
        ${displayThreads.map(t => {
            const isCollapsed = check_moderation_status(t.up_count || 0, t.down_count || 0, 3);
            const myVote = myVotes[t.id];
            const dateStr = new Date(t.created_at || t.t).toLocaleDateString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
            const replyCount = (t.replies || []).length;

            // 一覧表示時（非フォーカス時）のタイル型グリッドカード
            if (!isFocusMode) {
                return `
                <div class="thread-item-summary ${isCollapsed ? 'collapsed' : ''}" id="t-${t.id}" onclick="toggleThread('${t.id}')">
                    ${t.img ? `
                        <div class="thread-card-thumb-banner">
                            <img src="${t.img}" class="thread-card-thumb-img" alt="thumbnail">
                        </div>
                    ` : ''}
                    <div class="thread-summary-content">
                        <div class="thread-summary-header">
                            <span class="thread-summary-author">
                                ${escapeHtml(t.author || '名無し')}
                                <small style="color:var(--sub); opacity:0.7;">#${t.fp}</small>
                            </span>
                            <span class="thread-summary-date">${dateStr}</span>
                        </div>
                        <div class="thread-summary-title">
                            ${escapeHtml(t.title)}
                        </div>
                        <div class="thread-summary-snippet">
                            ${escapeHtml(t.body.replace(/(\r\n|\n|\r)/gm, " "))}
                        </div>
                        <div class="thread-summary-footer">
                            <div class="thread-summary-tags">
                                ${(t.tags || []).map(tg => `<span class="tag-badge">#${tg}</span>`).join('')}
                            </div>
                            <div class="thread-summary-stats" onclick="event.stopPropagation();">
                                <span class="reply-count-badge ${replyCount > 0 ? 'has-replies' : ''}">💬 ${replyCount}</span>
                                <button class="btn-vote btn-vote-mini ${myVote === 'up' ? 'active-up' : ''}" onclick="vote('${t.id}', 'up')" ${myVote ? 'disabled' : ''}>👍 ${t.up_count || 0}</button>
                                <button class="btn-vote btn-vote-mini ${myVote === 'down' ? 'active-down' : ''}" onclick="vote('${t.id}', 'down')" ${myVote ? 'disabled' : ''}>👎 ${t.down_count || 0}</button>
                            </div>
                        </div>
                    </div>
                </div>
                `;
            }

            // スレッド詳細（フォーカス時）
            return `
                <div class="thread-item thread-item-focused ${isCollapsed ? 'collapsed' : ''}" id="t-${t.id}">
                    <div class="thread-header">
                        <span>
                            <strong style="color:var(--text);">${escapeHtml(t.author || '名無し')}</strong>
                            <small style="opacity:0.7; margin-left:4px;">#${t.fp}</small>
                            <button class="btn-vote btn-vote-mini" onclick="voteUser('${t.fp}', 'up')" title="ユーザーを高評価">👍</button>
                            <button class="btn-vote btn-vote-mini" onclick="voteUser('${t.fp}', 'down')" title="ユーザーを低評価">👎</button>
                        </span>
                        <span>${dateStr}</span>
                    </div>
                    <div class="thread-title" style="font-size:1.3rem; margin:8px 0 12px; color:#fff;">
                        ${escapeHtml(t.title)}
                    </div>
                    
                    ${isCollapsed ? `<div class="collapse-notice" onclick="document.getElementById('body-${t.id}').style.display='block'">[!] 低評価多数のため折りたたまれています (展開)</div>` : ''}

                    <div id="body-${t.id}" style="${isCollapsed ? 'display:none;' : ''}">
                        <div class="post-content" style="font-size:0.95rem;">${linkify(escapeHtml(t.body))}</div>
                        ${t.img ? `<img src="${t.img}" class="post-img" onclick="openBase64Image('${t.img}')" style="max-width:320px; max-height:320px; border-radius:8px;">` : ''}
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:10px; border-top:1px solid var(--border);">
                        <div>${(t.tags || []).map(tg => `<span class="tag-badge">#${tg}</span>`).join('')}</div>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button class="btn-vote ${myVote === 'up' ? 'active-up' : ''}" onclick="vote('${t.id}', 'up')" ${myVote ? 'disabled' : ''}>👍 ${t.up_count || 0}</button>
                            <button class="btn-vote ${myVote === 'down' ? 'active-down' : ''}" onclick="vote('${t.id}', 'down')" ${myVote ? 'disabled' : ''}>👎 ${t.down_count || 0}</button>
                        </div>
                    </div>

                    <!-- レス一覧と返信フォーム -->
                    <div class="replies-box" style="margin-top:18px;">
                        <div style="font-size:0.85rem; font-weight:bold; color:var(--text); margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                            <span>💬 レスポンス (${replyCount}件)</span>
                        </div>
                        ${(t.replies || []).length === 0 ? `<div style="font-size:0.82rem; color:var(--sub); padding:10px; text-align:center; background:#14171e; border-radius:6px;">まだレスはありません。最初の返信を投稿しよう！</div>` : ''}
                        ${(t.replies || []).map(r => {
                            const myReplyVote = myVotes[r.id];
                            const isReplyCollapsed = check_moderation_status(r.up_count || 0, r.down_count || 0, 3);
                            return `
                            <div class="reply-item ${isReplyCollapsed ? 'collapsed' : ''}" id="r-${r.id}">
                                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--sub); margin-bottom:4px;">
                                    <span>
                                        <span class="${r.is_op ? 'author-op' : ''}">${escapeHtml(r.a)} ${r.is_op ? '(★主)' : ''}</span>
                                        <small style="opacity:0.7; margin-left:4px;">#${r.fp}</small>
                                        <button class="btn-vote btn-vote-mini" onclick="voteUser('${r.fp}', 'up')" title="ユーザーを高評価">👍</button>
                                        <button class="btn-vote btn-vote-mini" onclick="voteUser('${r.fp}', 'down')" title="ユーザーを低評価">👎</button>
                                    </span>
                                    <span>${new Date(r.t).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'})}</span>
                                </div>
                                ${isReplyCollapsed ? `<div class="collapse-notice" onclick="document.getElementById('r-body-${r.id}').style.display='block'">[!] 低評価多数のレス (展開)</div>` : ''}
                                <div id="r-body-${r.id}" style="${isReplyCollapsed ? 'display:none;' : ''}">
                                    <div class="post-content">${linkify(escapeHtml(r.body))}</div>
                                </div>
                                <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:6px;">
                                    <button class="btn-vote btn-vote-mini ${myReplyVote === 'up' ? 'active-up' : ''}" onclick="voteReply('${t.id}', '${r.id}', 'up')" ${myReplyVote ? 'disabled' : ''}>👍 ${r.up_count || 0}</button>
                                    <button class="btn-vote btn-vote-mini ${myReplyVote === 'down' ? 'active-down' : ''}" onclick="voteReply('${t.id}', '${r.id}', 'down')" ${myReplyVote ? 'disabled' : ''}>👎 ${r.down_count || 0}</button>
                                </div>
                            </div>
                            `;
                        }).join('')}
                        <form onsubmit="postReply(event, '${t.id}')" style="display:flex; flex-direction:column; gap:8px; margin-top:12px; background:#14171e; padding:12px; border-radius:6px; border:1px solid var(--border);">
                            <input type="text" placeholder="名前 (空欄で名無し)" class="input-text reply-author-input" style="margin:0; font-size:0.85rem;" maxlength="20">
                            <div style="display:flex; gap:8px;">
                                <input type="text" placeholder="返信を入力..." class="input-text reply-body-input" style="margin:0; flex:1; font-size:0.85rem;" required maxlength="200">
                                <button type="submit" class="btn-main" style="width:auto; padding:0 18px; font-size:0.82rem; white-space:nowrap;">返信</button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// 新規スレッド作成
export async function createThread(title, author, body, file, fpId) {
    if (!supabase) {
        alert("サーバーに接続できません。スレッドを作成できませんでした。");
        return false;
    }

    // 1. BANチェック (存在しない場合にエラーにならないよう maybeSingle を使用)
    const { data: ban } = await supabase.from('banned_users').select('reason').eq('fp', fpId).maybeSingle();
    if (ban) {
        alert(`この端末は利用停止（BAN）されています。\n理由: ${ban.reason || '規約違反'}`);
        return false;
    }

    // 2. 直近の投稿クールダウンチェック（3分以内の連投を禁止）
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: recentPosts } = await supabase
        .from('threads')
        .select('created_at')
        .eq('fp', fpId)
        .gte('created_at', threeMinutesAgo);

    if (recentPosts && recentPosts.length > 0) {
        alert("投稿間隔が短すぎます。スレッド作成は3分間に1回までです。");
        return false;
    }

    // 3. 1日の上限チェック（24時間以内に10スレッドまで）
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: todayCount } = await supabase
        .from('threads')
        .select('*', { count: 'exact', head: true })
        .eq('fp', fpId)
        .gte('created_at', oneDayAgo);

    if (todayCount !== null && todayCount >= 10) {
        alert("1日のスレッド作成上限（10件）に達しました。明日以降に投稿してください。");
        return false;
    }

    const diceMatch = body.match(/dice(\d+)d(\d+)/i);
    if (diceMatch) {
        const secureSeed = fpId + Date.now() + '_' + Math.random();
        body += "\n" + roll_dice(parseInt(diceMatch[1]), parseInt(diceMatch[2]), secureSeed);
    }

    const tags = Array.from(body.matchAll(/#([^\s#]+)/g)).map(m => m[1]);
    const imgBase64 = await compressImage(file, 400, 0.6);

    solve_pow(fpId + title, 3);

    const newThread = {
        id: 't_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 3),
        title,
        author: author || '名無し',
        body,
        img: imgBase64,
        tags,
        fp: fpId,
        created_at: new Date().toISOString(),
        up_count: 0,
        down_count: 0,
        replies: []
    };

    const { error } = await supabase.from('threads').insert([newThread]);
    if (error) {
        alert("スレッドの作成に失敗しました: " + (error.message || "通信エラー"));
        return false;
    }

    await fetchAndRender(fpId);
    return true;
}

// 返信送信
window.postReply = async function(e, threadId) {
    e.preventDefault();
    const fpId = localStorage.getItem('_fp_id') || 'anon';
    const authorInput = e.target.querySelector('.reply-author-input');
    const bodyInput = e.target.querySelector('.reply-body-input');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    let rawAuthor = authorInput ? authorInput.value.trim() : '';
    let body = bodyInput.value.trim();
    if (!body) return;

    if (!supabase) {
        alert("サーバーに接続できません。返信を送信できませんでした。");
        return;
    }

    // BANチェック
    const { data: ban } = await supabase.from('banned_users').select('reason').eq('fp', fpId).maybeSingle();
    if (ban) {
        alert(`この端末は利用停止（BAN）されています。\n理由: ${ban.reason || '規約違反'}`);
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '...';
    
    await new Promise(r => setTimeout(r, 10));
    solve_pow(fpId + threadId + Date.now(), 3);

    const diceMatch = body.match(/dice(\d+)d(\d+)/i);
    if (diceMatch) {
        const secureSeed = fpId + Date.now() + '_' + Math.random();
        body += "\n" + roll_dice(parseInt(diceMatch[1]), parseInt(diceMatch[2]), secureSeed);
    }

    // 最新のスレッド情報をDBから取得して競合上書きを防ぐ
    const { data: latestThread, error: fetchErr } = await supabase.from('threads').select('replies, fp').eq('id', threadId).maybeSingle();
    if (fetchErr || !latestThread) {
        alert("スレッド情報の取得に失敗しました。");
        submitBtn.disabled = false;
        submitBtn.textContent = '返信';
        return;
    }

    // 名前を入力していて、かつスレッド作成者ならスレ主フラグを立てる
    const isOpPost = (latestThread.fp === fpId) && (rawAuthor.length > 0) && (rawAuthor !== '名無し');
    const authorName = rawAuthor.length > 0 ? rawAuthor : '名無し';

    const newReply = {
        id: 'r_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 3),
        a: authorName,
        body,
        fp: fpId,
        t: Date.now(),
        is_op: isOpPost,
        up_count: 0,
        down_count: 0
    };

    const updatedReplies = [...(latestThread.replies || []), newReply];

    const { error } = await supabase.from('threads').update({ replies: updatedReplies }).eq('id', threadId);
    if (error) {
        alert("返信の送信に失敗しました。");
        submitBtn.disabled = false;
        submitBtn.textContent = '返信';
        return;
    }

    bodyInput.value = '';
    submitBtn.disabled = false;
    submitBtn.textContent = '返信';
    await fetchAndRender(fpId);
};

// 投票処理
window.vote = async function(id, type) {
    if (!supabase) {
        alert("サーバーに接続できません。");
        return;
    }

    const fpId = localStorage.getItem('_fp_id') || 'anon';
    const myVotes = JSON.parse(localStorage.getItem('hub_my_votes') || '{}');
    if (myVotes[id]) return;

    const { error: voteErr } = await supabase.from('votes').insert([{ thread_id: id, fp: fpId, vote_type: type }]);
    if (voteErr) { alert("すでに投票済みです。"); return; }

    const t = cachedThreads.find(x => x.id === id);
    if (t) {
        const updateData = type === 'up' ? { up_count: (t.up_count || 0) + 1 } : { down_count: (t.down_count || 0) + 1 };
        await supabase.from('threads').update(updateData).eq('id', id);
    }

    myVotes[id] = type;
    localStorage.setItem('hub_my_votes', JSON.stringify(myVotes));
    await fetchAndRender(fpId);
};

function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[m]);
}

// スレッドのレス詳細の開閉・フォーカスを切り替えるグローバル関数
window.toggleThread = function(threadId) {
    if (threadId === null || window._expandedThreadId === threadId) {
        window._expandedThreadId = null; // 一覧に戻る、または閉じる
    } else {
        window._expandedThreadId = threadId; // 選択したスレッドにフォーカス
    }
    const fpId = localStorage.getItem('_fp_id') || 'anon';
    renderBoardUI(fpId);
};
window.openBase64Image = function(base64Data) {
    const win = window.open('about:blank', '_blank');
    if (win) {
        win.document.title = 'Image Preview';
        win.document.body.style.cssText = 'margin:0;background:#0e0e0e;display:flex;align-items:center;justify-content:center;height:100vh;';
        const img = win.document.createElement('img');
        img.src = base64Data;
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
        win.document.body.appendChild(img);
    }
};
// レス単位の投票処理
window.voteReply = async function(threadId, replyId, type) {
    if (!supabase) {
        alert("サーバーに接続できません。");
        return;
    }

    const myVotes = JSON.parse(localStorage.getItem('hub_my_votes') || '{}');
    if (myVotes[replyId]) return;

    // 最新の replies データをDBから取得
    const { data: threadData, error } = await supabase.from('threads').select('replies').eq('id', threadId).maybeSingle();
    if (error || !threadData || !threadData.replies) return;

    const replies = threadData.replies;
    const reply = replies.find(r => r.id === replyId);
    if (!reply) return;

    if (type === 'up') reply.up_count = (reply.up_count || 0) + 1;
    if (type === 'down') reply.down_count = (reply.down_count || 0) + 1;

    const { error: updateErr } = await supabase.from('threads').update({ replies }).eq('id', threadId);
    if (updateErr) {
        alert("投票に失敗しました。");
        return;
    }

    myVotes[replyId] = type;
    localStorage.setItem('hub_my_votes', JSON.stringify(myVotes));
    const fpId = localStorage.getItem('_fp_id') || 'anon';
    await fetchAndRender(fpId);
};

// 個人（FP）単位の評価投票
window.voteUser = async function(targetFp, type) {
    if (!supabase) {
        alert("サーバーに接続できません。");
        return;
    }

    const myVotes = JSON.parse(localStorage.getItem('hub_my_votes') || '{}');
    const voteKey = 'user_' + targetFp;
    if (myVotes[voteKey]) {
        alert("このユーザーには既に評価済みです。");
        return;
    }

    const { error } = await supabase.from('user_reputations').insert([{
        target_fp: targetFp,
        vote_type: type,
        voter_fp: localStorage.getItem('_fp_id') || 'anon'
    }]);

    if (error) {
        alert("評価の送信に失敗しました: すでに評価済みか、エラーが発生しました。");
        return;
    }

    myVotes[voteKey] = type;
    localStorage.setItem('hub_my_votes', JSON.stringify(myVotes));
    alert(`${targetFp} に ${type === 'up' ? '高評価👍' : '低評価👎'} を送信しました。`);
};