// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE_URL      = 'http://192.168.49.2:30080';  // audit log backend
const REDIS_API_URL     = 'http://192.168.49.2:30080';  // Redis-backed backend
const K8S_API_URL       = 'http://192.168.49.2:30007'; 
const POLL_INTERVAL_MS  = 30000;
const PODS_POLL_MS      = 15000;

// ─── Navigation ──────────────────────────────────────────────────────────────
function switchView(viewId, navElement) {
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
        el.style.borderLeftColor = 'transparent';
    });
    navElement.classList.add('active');

    document.getElementById('audit-view').classList.add('hidden');
    document.getElementById('pods-view').classList.add('hidden');

    document.getElementById(viewId).classList.remove('hidden');
    document.getElementById(viewId).classList.add('flex');

    closePodPanel();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function classifyVerb(verb) {
    if (['create', 'update', 'patch'].includes(verb)) return 'action-pill-create';
    if (verb === 'delete')                             return 'action-pill-delete';
    if (['watch', 'list'].includes(verb))              return 'action-pill-watch';
    return 'action-pill-get';
}

function formatResource(objectRef) {
    if (!objectRef) return 'unknown';
    const kind     = objectRef.resource || 'resource';
    const singular = kind.endsWith('s') ? kind.slice(0, -1) : kind;
    const label    = singular.charAt(0).toUpperCase() + singular.slice(1);
    return objectRef.name ? `${label}/${objectRef.name}` : label;
}

function formatTimestamp(event) {
    const raw = event.stageTimestamp || event.requestReceivedTimestamp || '';
    if (!raw) return '';
    return raw.replace('T', ' ').substring(0, 19);
}

function relativeTime(isoStr) {
    if (!isoStr) return '—';
    const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// Sort entries by count descending, return top N
function topN(obj, n = 5) {
    return Object.entries(obj || {})
        .map(([k, v]) => ({ k, v: parseInt(v, 10) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, n);
}

function codeColor(code) {
    const c = parseInt(code, 10);
    if (c >= 200 && c < 300) return 'text-secondary';
    if (c >= 400 && c < 500) return 'text-error';
    if (c >= 500)            return 'text-tertiary';
    return 'text-on-surface-variant';
}

// ─── Audit Log ───────────────────────────────────────────────────────────────
const logContainer    = document.getElementById('log-container');
const expandedAuditIds = new Set();
let lastRenderedLogs  = [];

function toggleExpand(auditId) {
    expandedAuditIds.has(auditId) ? expandedAuditIds.delete(auditId) : expandedAuditIds.add(auditId);
    renderLogs(lastRenderedLogs);
}

function toDisplayLog(event) {
    const verb     = event.verb || 'unknown';
    const user     = (event.user && event.user.username) || 'unknown-user';
    const decision = (event.annotations && event.annotations['authorization.k8s.io/decision']) || 'unknown';
    return {
        auditId:   event.auditID || JSON.stringify(event),
        timestamp: formatTimestamp(event),
        verb,
        pillClass: classifyVerb(verb),
        user,
        resource:  formatResource(event.objectRef),
        decision,
        rawJson:   JSON.stringify(event, null, 2),
    };
}

function createLogCardHTML(log) {
    const decisionIcon  = log.decision === 'allow' ? 'check_circle' : (log.decision === 'deny' ? 'cancel' : 'help');
    const decisionClass = log.decision === 'allow' ? 'decision-allow' : (log.decision === 'deny' ? 'decision-deny' : '');
    const isExpanded    = expandedAuditIds.has(log.auditId);
    const safeId        = log.auditId.replace(/'/g, "\\'");

    return `
        <div class="log-card w-full cursor-pointer flex flex-col group ${isExpanded ? 'expanded' : ''}" onclick="toggleExpand('${safeId}')">
            <div class="flex items-center justify-between p-[12px] gap-4">
                <div class="flex items-center gap-4 flex-1 min-w-0">
                    <span class="font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap shrink-0">${log.timestamp}</span>
                    <span class="font-code-sm text-code-sm px-2 py-0.5 rounded-sm uppercase tracking-wider ${log.pillClass} shrink-0">${log.verb}</span>
                    <span class="font-code-sm text-code-sm text-primary truncate max-w-[200px]" title="${escapeHtml(log.user)}">${escapeHtml(log.user)}</span>
                    <span class="font-body-sm text-body-sm text-on-surface truncate flex-1">${escapeHtml(log.resource)}</span>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <div class="flex items-center gap-1 ${decisionClass}">
                        <span class="material-symbols-outlined text-[16px]" style="font-variation-settings: 'FILL' 1;">${decisionIcon}</span>
                        <span class="font-label-caps text-label-caps uppercase">${log.decision}</span>
                    </div>
                    <span class="material-symbols-outlined text-outline-variant text-[20px] transition-transform duration-200 group-[.expanded]:rotate-180">expand_more</span>
                </div>
            </div>
            <div class="${isExpanded ? 'block' : 'hidden'} border-t border-outline-variant p-[12px] bg-surface-container-lowest">
                <pre class="font-code-sm text-code-sm text-on-surface-variant overflow-x-auto m-0"><code>${escapeHtml(log.rawJson)}</code></pre>
            </div>
        </div>`;
}

function renderLogs(logs) {
    lastRenderedLogs = logs;
    if (!logs.length) {
        logContainer.innerHTML = `<div class="p-6 text-on-surface-variant font-body-md text-body-md">No events yet.</div>`;
        return;
    }
    logContainer.innerHTML = logs.map(createLogCardHTML).join('');
}

async function fetchAndRender() {
    try {
        const res  = await fetch(`${API_BASE_URL}/api/logs`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        renderLogs((data.events || []).map(toDisplayLog));
    } catch (err) {
        console.error('Audit log fetch failed:', err);
        logContainer.innerHTML = `<div class="p-6 text-error font-body-md text-body-md">Could not reach backend at ${API_BASE_URL}.</div>`;
    }
}

fetchAndRender();
setInterval(fetchAndRender, POLL_INTERVAL_MS);

// ─── Pods View ────────────────────────────────────────────────────────────────
// The Redis API returns:
//   GET /api/pods           → { namespace, count, pods: ["name1", "name2", ...] }
//   GET /api/pods/<name>    → { pod, last_seen, verb_counts, user_counts,
//                               resource_counts, response_codes, stage_counts,
//                               total_events, recent_events }

let lastPodNames = [];       // string[]
let podSummaryCache = {};    // name → summary object

async function fetchAndRenderPods() {
    const podsContainer = document.getElementById('pods-container');
    try {
        // Get full pod objects from guardian-collector
        const res  = await fetch(`${K8S_API_URL}/api/pods`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        lastPodNames = data.pods || [];   // full objects {name, namespace, status...}
        renderPods();
    } catch (err) {
        console.error('Pods fetch failed:', err);
        podsContainer.innerHTML = `<div class="p-6 text-error font-body-md">Could not reach pod API.</div>`;
    }
}

function verbBadgesHTML(verbCounts) {
    const top = topN(verbCounts, 3);
    return top.map(({ k, v }) =>
        `<span class="font-code-sm text-code-sm px-1.5 py-0.5 rounded-sm ${classifyVerb(k)}">${k} <span class="opacity-70">${v}</span></span>`
    ).join('');
}

function renderPods() {
    const podsContainer = document.getElementById('pods-container');
    if (!lastPodNames.length) {
        podsContainer.innerHTML = `<div class="p-6 text-on-surface-variant">No pods found.</div>`;
        return;
    }

    const header = `
        <div class="log-card w-full flex items-center p-[12px] gap-4 bg-surface-container-lowest text-on-surface-variant font-label-caps text-label-caps uppercase sticky top-0 z-10">
            <div class="flex-1 min-w-[180px]">Pod Name</div>
            <div class="w-[110px]">Namespace</div>
            <div class="w-[90px]">Status</div>
            <div class="w-[60px]">Ready</div>
            <div class="w-[70px]">Restarts</div>
            <div class="w-[60px] text-right">Age</div>
        </div>`;

    const rows = lastPodNames.map((pod, index) => `
        <div class="log-card w-full cursor-pointer flex items-center p-[12px] gap-4" onclick="openPodPanel(${index})">
            <div class="flex-1 min-w-[180px] flex items-center gap-2">
                <span class="material-symbols-outlined text-[16px] text-on-surface-variant">deployed_code</span>
                <span class="font-code-sm text-code-sm text-primary truncate">${escapeHtml(pod.name)}</span>
            </div>
            <div class="w-[110px] font-code-sm text-on-surface-variant truncate">${escapeHtml(pod.namespace)}</div>
            <div class="w-[90px] flex items-center gap-2 font-body-sm">
                <span class="w-2 h-2 rounded-full ${pod.status === 'Running' ? 'bg-secondary' : 'bg-error'}"></span>
                ${escapeHtml(pod.status)}
            </div>
            <div class="w-[60px] font-code-sm text-on-surface-variant">${pod.ready}</div>
            <div class="w-[70px] font-code-sm text-on-surface-variant ${parseInt(pod.restarts) > 10 ? 'text-error' : ''}">${pod.restarts}</div>
            <div class="w-[60px] text-right font-code-sm text-on-surface-variant">${pod.age}</div>
        </div>`
    ).join('');

    podsContainer.innerHTML = header + rows;
}

fetchAndRenderPods();
setInterval(fetchAndRenderPods, PODS_POLL_MS);

// ─── Pod Detail Panel ─────────────────────────────────────────────────────────
function closePodPanel() {
    document.getElementById('pod-detail-panel').classList.remove('open');
}

function statBarHTML(label, entries, colorFn) {
    if (!entries.length) return '';
    const max = entries[0].v;
    const rows = entries.map(({ k, v }) => {
        const pct   = max > 0 ? Math.round((v / max) * 100) : 0;
        const color = colorFn ? colorFn(k) : 'bg-primary';
        return `
            <div class="flex items-center gap-2 mb-1">
                <span class="font-code-sm text-code-sm text-on-surface-variant w-[160px] truncate shrink-0" title="${escapeHtml(k)}">${escapeHtml(k)}</span>
                <div class="flex-1 h-[6px] rounded-full bg-surface-container-highest overflow-hidden">
                    <div class="${color} h-full rounded-full transition-all duration-500" style="width:${pct}%"></div>
                </div>
                <span class="font-code-sm text-code-sm text-on-surface-variant w-[32px] text-right shrink-0">${v}</span>
            </div>`;
    }).join('');
    return `
        <div class="mb-5">
            <div class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-2">${label}</div>
            ${rows}
        </div>`;
}

function verbBarColor(verb) {
    if (['create', 'update', 'patch'].includes(verb)) return 'bg-tertiary';
    if (verb === 'delete')                             return 'bg-error';
    if (['watch', 'list'].includes(verb))              return 'bg-primary-container';
    return 'bg-primary';
}

function codeBarColor(code) {
    const c = parseInt(code, 10);
    if (c >= 200 && c < 300) return 'bg-secondary';
    if (c >= 400 && c < 500) return 'bg-error';
    if (c >= 500)            return 'bg-tertiary';
    return 'bg-outline';
}

function recentEventsHTML(events) {
    if (!events || !events.length) return '';
    const rows = events.map(e => {
        const pill = `<span class="font-code-sm text-code-sm px-1.5 py-0.5 rounded-sm ${classifyVerb(e.verb)}">${escapeHtml(e.verb)}</span>`;
        const code = e.code ? `<span class="font-code-sm text-code-sm ${codeColor(e.code)}">${e.code}</span>` : '';
        const ts   = e.ts ? e.ts.replace('T', ' ').substring(0, 19) : '';
        const user = escapeHtml((e.user || '').split(':').pop()); // trim serviceaccount prefix
        return `
            <div class="flex items-center gap-2 py-1.5 border-b border-outline-variant last:border-0">
                ${pill}
                <span class="font-code-sm text-code-sm text-on-surface-variant flex-1 truncate" title="${escapeHtml(e.user || '')}">${user}</span>
                ${code}
                <span class="font-code-sm text-code-sm text-on-surface-variant shrink-0">${ts}</span>
            </div>`;
    }).join('');
    return `
        <div class="mb-5">
            <div class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-2">Recent Events</div>
            <div>${rows}</div>
        </div>`;
}

async function openPodPanel(index) {
    const pod  = lastPodNames[index];   // full object now
    const name = pod.name;
    const res = await fetch(`${REDIS_API_URL}/api/pods/${encodeURIComponent(name)}`);              // ← was being passed as object before
    
    document.getElementById('panel-pod-name').textContent = name;
    const panelBody = document.getElementById('panel-body');
    panelBody.innerHTML = `<div class="text-on-surface-variant font-body-md animate-pulse">Loading…</div>`;
    document.getElementById('pod-detail-panel').classList.add('open');

    try {
        const res = await fetch(`${REDIS_API_URL}/api/pods/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const s = await res.json();
        // ... rest of panel rendering unchanged

        // Header stats row
        const headerStats = `
            <div class="grid grid-cols-3 gap-2 mb-5">
                <div class="bg-surface-container-highest rounded p-3 text-center">
                    <div class="font-headline-md text-headline-md text-on-surface">${s.total_events ?? '—'}</div>
                    <div class="font-label-caps text-label-caps uppercase text-on-surface-variant mt-1">Total Events</div>
                </div>
                <div class="bg-surface-container-highest rounded p-3 text-center">
                    <div class="font-headline-md text-headline-md text-on-surface">${Object.keys(s.verb_counts || {}).length}</div>
                    <div class="font-label-caps text-label-caps uppercase text-on-surface-variant mt-1">Distinct Verbs</div>
                </div>
                <div class="bg-surface-container-highest rounded p-3 text-center">
                    <div class="font-headline-md text-headline-md text-on-surface">${Object.keys(s.user_counts || {}).length}</div>
                    <div class="font-label-caps text-label-caps uppercase text-on-surface-variant mt-1">Distinct Users</div>
                </div>
            </div>
            <div class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-3">
                Last seen: <span class="text-primary">${relativeTime(s.last_seen)}</span>
            </div>`;

        const verbBars     = statBarHTML('Verb Counts',          topN(s.verb_counts, 8),          verbBarColor);
        const userBars     = statBarHTML('Users / ServiceAccounts', topN(s.user_counts, 6),       () => 'bg-primary');
        const resourceBars = statBarHTML('Resources Accessed',   topN(s.resource_counts, 6),      () => 'bg-primary-container');
        const codeBars     = statBarHTML('Response Codes',       topN(s.response_codes, 6),       codeBarColor);
        const stageBars    = statBarHTML('Stages',               topN(s.stage_counts, 6),         () => 'bg-outline');
        const recent       = recentEventsHTML(s.recent_events || []);

        panelBody.innerHTML = headerStats + verbBars + userBars + resourceBars + codeBars + stageBars + recent;
    } catch (err) {
        console.error('Pod detail fetch failed:', err);
        panelBody.innerHTML = `<div class="text-error font-body-md text-body-md">Could not load details for ${escapeHtml(name)}.</div>`;
    }
}