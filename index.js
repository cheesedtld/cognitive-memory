/**
 * 认知记忆 (Cognitive Memory) — SillyTavern Extension
 *
 * 与 cognitive-memory Server Plugin 配合使用。
 * - 自动索引对话到认知记忆库
 * - AI 生成前自动搜索并注入记忆到 prompt
 * - 设置面板：API 配置、权重调参、衰减速率
 * - 记忆浏览器：查看/编辑/删除/标记核心
 * - 砖头机联动：推拉认知记忆块
 */

const MODULE_NAME = 'cognitive_memory';
const COG_API = '/api/plugins/zhuantouji-sync';




// ============ 状态 ============
let pluginOnline = false;




function getCharName() {
    const ctx = SillyTavern.getContext();
    if (ctx.characterId !== undefined && ctx.characters[ctx.characterId]) {
        return ctx.characters[ctx.characterId].name || '';
    }
    return '';
}

function getChatTag() {
    const charName = getCharName();
    const ctx = SillyTavern.getContext();
    const chatId = ctx.chatId || 'default';
    return `chat:${charName}:${chatId}`;
}

async function apiCall(endpoint, options = {}) {
    const ctx = SillyTavern.getContext();
    const fetchOpts = {
        method: options.method || 'GET',
        headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
    };
    if (options.body) fetchOpts.body = JSON.stringify(options.body);
    const res = await fetch(`${COG_API}${endpoint}`, fetchOpts);
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status}: ${txt.substring(0, 200)}`);
    }
    return res.json();
}

function setActionStatus(text, type = '') {
    const el = document.getElementById('cogmem_action_status');
    if (!el) return;
    el.textContent = text;
    el.className = 'cogmem-action-status ' + type;
    if (type) setTimeout(() => { el.textContent = ''; el.className = 'cogmem-action-status'; }, 4000);
}


// ============ 操作：砖头机同步 ============
async function doSyncPush(asVector) {
    const charName = getCharName();
    if (!charName) { setActionStatus('请先打开角色聊天', 'error'); return; }

    const userName = SillyTavern.getContext().name1 || 'User';
    const characterName = SillyTavern.getContext().name2 || charName;

    // 1. 获取聊天消息并找到上次节点
    let messages = [];
    if (typeof getChatMessages === 'function') {
        const lastId = typeof getLastMessageId === 'function' ? getLastMessageId() : 0;
        messages = getChatMessages(`0-${lastId}`);
    }
    if (!messages || messages.length === 0) { setActionStatus('当前聊天没有消息', 'error'); return; }

    let startIndex = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msgText = messages[i].message || '';
        if (msgText.includes('正式切换为线下见面/现实互动模式') || msgText.includes('已同步到砖头机：线下记忆摘要')) {
            startIndex = i + 1;
            break;
        }
    }
    messages = messages.slice(startIndex);
    if (messages.length === 0) { setActionStatus('上次同步后暂无新内容', ''); return; }

    let chatText = '';
    messages.forEach(msg => {
        const sender = msg.is_user ? userName : characterName;
        const content = (msg.message || '').substring(0, 800);
        chatText += `${sender}: ${content}\n`;
    });
    if (chatText.length > 25000) chatText = '...(前面的内容已省略)\n' + chatText.slice(-25000);

    const summaryPrompt = `你是一个情感细腻的故事记录者。请仔细阅读以下两人之间的对话记录，并为他们提取一份充满人情味、画面感和情感张力的“记忆档案”。

【重要写作红线 - 绝对禁止】
1. 拒绝机械化报告Tone：严禁使用“在这段对话中”、“展现了”、“说明了”、“用户与角色”、“产生互动”等冰冷的、上帝视角的分析式套话。
2. 拒绝“AI味”专有名词：严禁出现“羁绊”、“情感共鸣”、“灵魂交织”、“宿命感”、“情感升温”、“拉扯”等泛滥且油腻的AI总结词汇。
3. 称呼自然：直接使用名字“${userName}”和“${characterName}”，绝对不要使用“用户”、“玩家”、“角色”、“AI”等出戏称呼。

【写作指引】
沉浸式回忆：请用像写小说设定集。细腻地捕捉两人之间的情绪流动、空气中的温度，以及那些没有明说的心思。让文字能够真实触动人心。

对话内容：
${chatText}

请按照以下格式输出你的档案：

【剧情总结】
(抛弃干瘪的流水账，用细腻柔和、充满情感温度的语言，回顾两人这段时间共同经历的故事脉络。重点描绘他们之间发生的特殊事件、关键抉择以及两人内心情绪。1000字左右。)

【当前关系状态】
(请用一两句话精准概括当下微妙的心理距离。例如：${userName} & ${characterName}：正处于患得患失的暧昧期，彼此试探却又忍不住向对方靠近。)

【关键记忆碎片】
(按时间顺序，像幻灯片一样，列举出几幕推动两人关系发展的具体事件画面。写出当时的情境氛围和彼此的心情。)

【时间跨度】
(记录这段经历的具体或大致时间跨度。)

【言外之意与暗线】
(记录那些欲言又止的细节、未解开的心结、伏笔。)

【情感信物】
(如果有提及，描述具有特殊情感意义的物品、互送的礼物或某个承载回忆的地点，并说明它对两人意味着什么。若无则简要注明即可。)

只输出以上六个板块的内容，千万不要添加开头和结尾的额外寒暄说明文字。`;

    try {
        setActionStatus('正在生成总结，请稍候...', 'info');
        const summary = await window.generateRaw({
            user_input: summaryPrompt,
            should_silence: true,
            max_chat_history: 0,
            max_tokens: 4096,
            ordered_prompts: ['user_input']
        });

        if (!summary || !summary.trim()) throw new Error('摘要生成失败：返回为空');
        
        if (asVector) {
            const memoryEntry = {
                id: 'card_st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                text: summary.trim(),
                source: 'st',
                timestamp: Date.now(),
                isCore: true
            };
            // 2. 推送到认知记忆后端
            await apiCall('/sync/push', {
                method: 'POST',
                body: { chatTag: `chat:${getCharName()}`, source: 'st', memories: [memoryEntry] }
            });
            
            // 3. 插入本地聊天流
            const summaryMessage = `<details>\n<summary>📱 <b>已同步到砖头机：线下卡片 (触发打标)</b></summary>\n\n${summary.trim()}\n\n</details>\n\n*(系统提示：以上线下互动记忆已同步至砖头机并打标为核心向量，线上聊天时角色会自然地体现对这些经历的了解。)*`;
            if (typeof createChatMessages === 'function') {
                await createChatMessages([{ role: 'system', message: summaryMessage }]);
            }
            setActionStatus(`✅ 成功生成剧情总结并推送为向量卡片！`, 'success');
        } else {
            // 推送到传统的 zhuantouji-sync 后端
            const memoryEntry = {
                t: `线下 AIRP 记忆 (${new Date().toLocaleString()})`,
                c: summary.trim(),
                ts: new Date().toISOString(),
            };
            const fetchOptions = {
                method: 'POST',
                headers: { ...SillyTavern.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ char: getCharName(), source: 'st', memories: [memoryEntry] })
            };
            const res = await fetch('/api/plugins/zhuantouji-sync/push', fetchOptions);
            if (!res.ok) throw new Error(`Traditional API Error ${res.status}`);
            
            // 3. 插入本地聊天流
            const summaryMessage = `<details>\n<summary>📱 <b>已同步到砖头机：线下记忆摘要 (纯总结)</b></summary>\n\n${summary.trim()}\n\n</details>\n\n*(系统提示：以上线下互动记忆已同步至砖头机的记忆列表，线上聊天时角色会自然地体现对这些经历的了解。)*`;
            if (typeof createChatMessages === 'function') {
                await createChatMessages([{ role: 'system', message: summaryMessage }]);
            }
            setActionStatus(`✅ 成功生成剧情总结并推送到记忆列表！`, 'success');
        }
    } catch (e) {
        setActionStatus(`❌ ${e.message}`, 'error');
    }
}

async function syncPullTrad() {
    const charName = getCharName();
    if (!charName) { setActionStatus('请先打开角色聊天', 'error'); return; }
    try {
        const fetchOptions = { headers: SillyTavern.getRequestHeaders() };
        const res = await fetch(`/api/plugins/zhuantouji-sync/pull?char=${encodeURIComponent(charName)}&source=ztj`, fetchOptions);
        if (res.ok) {
            const result = await res.json();
            if (result.memories && result.memories.length > 0) {
                let injectContent = '<details>\n<summary>📱 <b>点击展开：从砖头机同步的线上聊天前情</b></summary>\n\n';
                result.memories.forEach((mem, i) => {
                    injectContent += `[线上记忆${i + 1}: ${mem.t || '日常聊天'}]\n${mem.c || ''}\n\n`;
                });
                injectContent += '</details>\n\n*(系统提示：双方已结束线上交流，正式切换为线下见面/现实互动模式。请结合上方的前情摘要，自然流畅地展开接下来的剧情。)*';
                
                if (typeof createChatMessages === 'function') {
                    await createChatMessages([{ role: 'system', message: injectContent }]);
                }
                setActionStatus(`✅ 成功拉取砖头机总结并插入背景！`, 'success');
            } else {
                setActionStatus('暂无来自砖头机的新聊天总结', '');
            }
        }
    } catch (e) { setActionStatus(`❌ 传统拉取失败: ${e.message}`, 'error'); }
}

async function syncPullVec() {
    const charName = getCharName();
    if (!charName) { setActionStatus('请先打开角色聊天', 'error'); return; }
    try {
        const syncChatTag = `chat:${charName}`;
        const data = await apiCall(`/memories?chatTag=${encodeURIComponent(syncChatTag)}&limit=1000`);
        const cards = (data?.memories || []).filter(m => m.id && m.id.startsWith('card_ztj_') && !m.isArchived);

        if (cards.length > 0) {
            let injectContent = '<details>\n<summary>📱 <b>点击展开：从砖头机同步的前情提要（近3条日记）</b></summary>\n\n';
            for (const mem of cards) {
                await apiCall(`/memories/${encodeURIComponent(mem.id)}`, { method: 'PUT', body: { isArchived: true } });
            }
            const displayCards = cards
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, 3)
                .reverse();

            for (const [i, mem] of displayCards.entries()) {
                injectContent += `[事件日记 ${i + 1}]\n${mem.text || ''}\n\n`;
            }
            injectContent += '</details>\n\n*(系统提示：以上是近三天砖头机线下的事件日记背景，请结合这些线索，自然流畅地展开接下来的剧情。)*';

            if (typeof createChatMessages === 'function') {
                await createChatMessages([{ role: 'system', message: injectContent }]);
            }
            setActionStatus(`✅ 成功拉取砖头机日记卡片并插入背景！`, 'success');
        } else {
            setActionStatus('暂无来自砖头机的未读日记卡片', '');
        }
    } catch (e) { setActionStatus(`❌ 向量拉取失败: ${e.message}`, 'error'); }
}




// ============ UI ↔ Settings 双向绑定 ============
function populateUI() {
    // 界面已极简为“剧情驿站”卡片化同步，不再需要复杂的参数配置。
}

function bindEvents() {
    // 按钮
    document.getElementById('cogmem_btn_push_trad')?.addEventListener('click', () => doSyncPush(false));
    document.getElementById('cogmem_btn_pull_trad')?.addEventListener('click', syncPullTrad);
    document.getElementById('cogmem_btn_push_vec')?.addEventListener('click', () => doSyncPush(true));
    document.getElementById('cogmem_btn_pull_vec')?.addEventListener('click', syncPullVec);
}

// ============ 初始化 ============
(async function init() {
    try {
        const ctx = SillyTavern.getContext();
        console.log('[CogMem] 🚀 前端扩展初始化开始...');

        // 检测插件
        try {
            const status = await apiCall('/status');
            pluginOnline = !!(status && (status.plugin === 'cognitive-memory' || status.status === 'ok'));
            console.log('[CogMem] 插件状态:', pluginOnline ? '在线' : '离线');
        } catch (e) {
            pluginOnline = false;
            console.warn('[CogMem] ⚠️ 无法连接服务端插件:', e.message);
        }

        // 渲染设置面板
        const { renderExtensionTemplateAsync } = ctx;
        const settingsHtml = await renderExtensionTemplateAsync('third-party/cognitive-memory-ext', 'settings');
        $('#extensions_settings2').append(settingsHtml);
        console.log('[CogMem] ✅ 设置面板已渲染');

        // 填充 UI
        try { populateUI(); console.log('[CogMem] ✅ populateUI 完成'); }
        catch (e) { console.error('[CogMem] ❌ populateUI 崩溃:', e); }

        // 绑定事件（独立 try-catch，确保即使 populateUI 崩溃也能绑定按钮）
        try { bindEvents(); console.log('[CogMem] ✅ bindEvents 完成'); }
        catch (e) { console.error('[CogMem] ❌ bindEvents 崩溃:', e); }

        // 更新状态徽章
        const badge = document.getElementById('cogmem_status_badge');
        if (badge) {
            if (pluginOnline) {
                badge.textContent = '已连接';
                badge.style.background = '#28a745';
            } else {
                badge.textContent = '未连接';
                badge.style.background = '#dc3545';
            }
        }

        // 事件钩子
        const { eventSource, event_types } = ctx;


        console.log(`[CogMem] 🧱 剧情驿站扩展已加载 (服务器: ${pluginOnline ? '已连接' : '未连接'})`);
    } catch (fatalErr) {
        console.error('[CogMem] ❌❌❌ 扩展初始化失败:', fatalErr);
    }
})();
