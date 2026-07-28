// --- Navigation Logic ---
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

// --- Audit Log Logic (unchanged) ---
const API_BASE_URL = 'http://192.168.49.2:30080';
const POLL_INTERVAL_MS = 30000;

const logContainer = document.getElementById('log-container');
const expandedAuditIds = new Set();
let lastRenderedLogs = [];

function toggleExpand(auditId) {
    if (expandedAuditIds.has(auditId)) {
        expandedAuditIds.delete(auditId);
    } else {
        expandedAuditIds.add(auditId);
    }
    renderLogs(lastRenderedLogs);
}

function classifyVerb(verb) {
    if (['create', 'update', 'patch'].includes(verb)) return 'action-pill-create';
    if (verb === 'delete') return 'action-pill-delete';
    return 'action-pill-get';
}

function formatResource(objectRef) {
    if (!objectRef) return 'unknown';
    const kind = objectRef.resource || 'resource';
    const singular = kind.endsWith('s') ? kind.slice(0, -1) : kind;
    const label = singular.charAt(0).toUpperCase() + singular.slice(1);
    return objectRef.name ? `${label}/${objectRef.name}` : label;
}

function formatTimestamp(event) {
    const raw = event.stageTimestamp || event.requestReceivedTimestamp || '';
    if (!raw) return '';
    return raw.replace('T', ' ').substring(0, 19);
}

function toDisplayLog(event) {
    const verb = event.verb || 'unknown';
    const user = (event.user && event.user.username) || 'unknown-user';
    const decision = (event.annotations && event.annotations['authorization.k8s.io/decision']) || 'unknown';

    return {
        auditId: event.auditID || JSON.stringify(event),
        timestamp: formatTimestamp(event),
        verb,
        pillClass: classifyVerb(verb),
        user,
        resource: formatResource(event.objectRef),
        decision,
        rawJson: JSON.stringify(event, null, 2),
    };
}

function createLogCardHTML(log) {
    const decisionIcon = log.decision === 'allow' ? 'check_circle' : (log.decision === 'deny' ? 'cancel' : 'help');
    const decisionClass = log.decision === 'allow' ? 'decision-allow' : (log.decision === 'deny' ? 'decision-deny' : '');
    const isExpanded = expandedAuditIds.has(log.auditId);
    const expandedClass = isExpanded ? 'expanded' : '';
    const safeId = log.auditId.replace(/'/g, "\\'");

    return `
        <div class="log-card w-full cursor-pointer flex flex-col group ${expandedClass}" onclick="toggleExpand('${safeId}')">
            <div class="flex items-center justify-between p-[12px] gap-4">
                <div class="flex items-center gap-4 flex-1 min-w-0">
                    <span class="font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap shrink-0">${log.timestamp}</span>

                    <span class="font-code-sm text-code-sm px-2 py-0.5 rounded-sm uppercase tracking-wider ${log.pillClass} shrink-0">
                        ${log.verb}
                    </span>

                    <span class="font-code-sm text-code-sm text-primary truncate max-w-[200px]" title="${log.user}">
                        ${log.user}
                    </span>

                    <span class="font-body-sm text-body-sm text-on-surface truncate flex-1">
                        ${log.resource}
                    </span>
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
                <pre class="font-code-sm text-code-sm text-on-surface-variant overflow-x-auto m-0"><code>${log.rawJson}</code></pre>
            </div>
        </div>
    `;
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
        const res = await fetch(`${API_BASE_URL}/api/logs`);
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const data = await res.json();
        const logs = (data.events || []).map(toDisplayLog);
        renderLogs(logs);
    } catch (err) {
        console.error('Failed to fetch audit logs:', err);
        logContainer.innerHTML = `<div class="p-6 text-error font-body-md text-body-md">Could not reach backend at ${API_BASE_URL}. Is it running and reachable?</div>`;
    }
}

fetchAndRender();
setInterval(fetchAndRender, POLL_INTERVAL_MS);

// --- Pods View Logic (real data, replacing the old dummy array) ---
const PODS_API_BASE_URL = 'http://192.168.49.2:30007'; // guardian-collector-service NodePort
const PODS_POLL_INTERVAL_MS = 15000;

let lastPods = [];

async function fetchAndRenderPods() {
    const podsContainer = document.getElementById('pods-container');
    try {
        const res = await fetch(`${PODS_API_BASE_URL}/api/pods`);
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const data = await res.json();
        lastPods = data.pods || [];
        renderPods();
    } catch (err) {
        console.error('Failed to fetch pods:', err);
        podsContainer.innerHTML = `<div class="p-6 text-error font-body-md text-body-md">Could not reach pod API at ${PODS_API_BASE_URL}.</div>`;
    }
}

function renderPods() {
    const podsContainer = document.getElementById('pods-container');

    if (!lastPods.length) {
        podsContainer.innerHTML = `<div class="p-6 text-on-surface-variant font-body-md text-body-md">No running pods found.</div>`;
        return;
    }

    let html = `
        <div class="log-card w-full flex items-center p-[12px] gap-4 bg-surface-container-lowest text-on-surface-variant font-label-caps uppercase sticky top-0 z-10">
            <div class="flex-1 min-w-[160px]">Name</div>
            <div class="w-[120px]">Namespace</div>
            <div class="w-[100px]">Status</div>
            <div class="w-[80px]">Ready</div>
            <div class="w-[80px]">Restarts</div>
            <div class="w-[120px]">Node</div>
            <div class="w-[60px] text-right">Age</div>
        </div>
    `;

    html += lastPods.map((pod, index) => `
        <div class="log-card w-full cursor-pointer flex items-center p-[12px] gap-4" onclick="openPodPanel(${index})">
            <div class="flex-1 min-w-[160px] font-code-sm text-primary truncate">${pod.name}</div>
            <div class="w-[120px] font-code-sm text-on-surface-variant truncate">${pod.namespace}</div>
            <div class="w-[100px] flex items-center gap-2 font-body-sm">
                <span class="w-2 h-2 rounded-full ${pod.status === 'Running' ? 'bg-secondary' : 'bg-error'}"></span>
                ${pod.status}
            </div>
            <div class="w-[80px] font-code-sm text-on-surface-variant">${pod.ready}</div>
            <div class="w-[80px] font-code-sm text-on-surface-variant">${pod.restarts}</div>
            <div class="w-[120px] font-code-sm text-on-surface-variant truncate">${pod.node || 'unknown'}</div>
            <div class="w-[60px] text-right font-code-sm text-on-surface-variant">${pod.age}</div>
        </div>
    `).join('');

    podsContainer.innerHTML = html;
}

fetchAndRenderPods();
setInterval(fetchAndRenderPods, PODS_POLL_INTERVAL_MS);

function yamlSectionHTML(title, yamlText) {
    return `
        <div class="mb-4">
            <div class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">${title}</div>
            <pre class="font-code-sm text-primary overflow-x-auto m-0 bg-surface-container-lowest p-3 rounded"><code>${escapeHtml(yamlText)}</code></pre>
        </div>
    `;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function openPodPanel(index) {
    const pod = lastPods[index];
    document.getElementById('panel-pod-name').textContent = pod.name;
    const panelBody = document.getElementById('panel-body');
    panelBody.innerHTML = `<div class="text-on-surface-variant font-body-md text-body-md">Loading...</div>`;
    document.getElementById('pod-detail-panel').classList.add('open');

    try {
        const res = await fetch(`${PODS_API_BASE_URL}/api/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}/resources`);
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const bundle = await res.json();

        let html = yamlSectionHTML('Pod', bundle.pod);
        if (bundle.deployment) {
            html += yamlSectionHTML('Deployment', bundle.deployment);
        }
        (bundle.services || []).forEach(svc => {
            html += yamlSectionHTML(`Service: ${svc.name}`, svc.yaml);
        });
        if (bundle.serviceaccount) {
            html += yamlSectionHTML('ServiceAccount', bundle.serviceaccount);
        }

        panelBody.innerHTML = html;
    } catch (err) {
        console.error('Failed to fetch pod resources:', err);
        panelBody.innerHTML = `<div class="text-error font-body-md text-body-md">Could not load resources for ${pod.name}.</div>`;
    }
}

function closePodPanel() {
    document.getElementById('pod-detail-panel').classList.remove('open');
}