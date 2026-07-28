// --- Navigation Logic ---
function switchView(viewId, navElement) {
    // Update nav styles
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
        el.style.borderLeftColor = 'transparent';
    });
    navElement.classList.add('active');

    // Toggle views
    document.getElementById('audit-view').classList.add('hidden');
    document.getElementById('pods-view').classList.add('hidden');
    
    document.getElementById(viewId).classList.remove('hidden');
    document.getElementById(viewId).classList.add('flex');
    
    // Close panel if open
    closePodPanel();
}

// --- Audit Log Logic ---
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

// Start backend log fetching loop
fetchAndRender();
setInterval(fetchAndRender, POLL_INTERVAL_MS);

// --- Pods View Logic ---
const dummyPods = [
    { name: "nginx-deployment-7f8d9b6c5-4rt2b", status: "Running", ready: "1/1", restarts: "0", node: "node-01", age: "2h" },
    { name: "frontend-service-app-2x9p8", status: "Running", ready: "1/1", restarts: "2", node: "node-02", age: "5d" },
    { name: "backend-api-v2-54b8d7ff79-jk9sm", status: "Running", ready: "1/1", restarts: "0", node: "node-01", age: "12h" },
    { name: "redis-cache-master-0", status: "Running", ready: "1/1", restarts: "0", node: "node-03", age: "14d" },
    { name: "metrics-server-84f9b8c6f-lq2zw", status: "Running", ready: "1/1", restarts: "1", node: "node-02", age: "3d" }
];

function renderPods() {
    const podsContainer = document.getElementById('pods-container');
    
    // Header row
    let html = `
        <div class="log-card w-full flex items-center p-[12px] gap-4 bg-surface-container-lowest text-on-surface-variant font-label-caps uppercase sticky top-0 z-10">
            <div class="flex-1 min-w-[200px]">Name</div>
            <div class="w-[100px]">Status</div>
            <div class="w-[80px]">Ready</div>
            <div class="w-[80px]">Restarts</div>
            <div class="w-[120px]">Node</div>
            <div class="w-[60px] text-right">Age</div>
        </div>
    `;

    html += dummyPods.map((pod, index) => `
        <div class="log-card w-full cursor-pointer flex items-center p-[12px] gap-4" onclick="openPodPanel(${index})">
            <div class="flex-1 min-w-[200px] font-code-sm text-primary truncate">${pod.name}</div>
            <div class="w-[100px] flex items-center gap-2 font-body-sm">
                <span class="w-2 h-2 rounded-full bg-secondary"></span>
                ${pod.status}
            </div>
            <div class="w-[80px] font-code-sm text-on-surface-variant">${pod.ready}</div>
            <div class="w-[80px] font-code-sm text-on-surface-variant">${pod.restarts}</div>
            <div class="w-[120px] font-code-sm text-on-surface-variant truncate">${pod.node}</div>
            <div class="w-[60px] text-right font-code-sm text-on-surface-variant">${pod.age}</div>
        </div>
    `).join('');
    
    podsContainer.innerHTML = html;
}

renderPods();

function openPodPanel(index) {
    const pod = dummyPods[index];
    document.getElementById('panel-pod-name').textContent = pod.name;
    
    const yaml = `apiVersion: v1
kind: Pod
metadata:
  name: ${pod.name}
  namespace: default
  labels:
    app: ${pod.name.split('-')[0]}
spec:
  containers:
  - name: main
    image: ${pod.name.split('-')[0]}:latest
    ports:
    - containerPort: 8080
  nodeName: ${pod.node}
status:
  phase: ${pod.status}
  hostIP: 192.168.1.10
  podIP: 10.244.1.55`;
    
    document.getElementById('panel-pod-yaml').textContent = yaml;
    document.getElementById('pod-detail-panel').classList.add('open');
}

function closePodPanel() {
    document.getElementById('pod-detail-panel').classList.remove('open');
}