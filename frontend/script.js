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

function escapeHtmlJs(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function createRawJsonCardHTML(event) {
    const auditId = event.auditID || '(no auditID)';
    const scannedAt = event._scanned_at || '';
    const rawJson = escapeHtmlJs(JSON.stringify(event, null, 2));

    return `
        <div class="log-card w-full flex flex-col">
            <div class="flex items-center justify-between px-[12px] pt-[10px] pb-1">
                <span class="font-code-sm text-code-sm text-primary truncate">${auditId}</span>
                <span class="font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap shrink-0">scanned: ${scannedAt}</span>
            </div>
            <pre class="font-code-sm text-code-sm text-on-surface-variant overflow-x-auto m-0 px-[12px] pb-[12px]"><code>${rawJson}</code></pre>
        </div>
    `;
}

function renderLogs(events) {
    if (!events.length) {
        logContainer.innerHTML = `<div class="p-6 text-on-surface-variant font-body-md text-body-md">No events yet.</div>`;
        return;
    }
    logContainer.innerHTML = events.map(createRawJsonCardHTML).join('');
}

async function fetchAndRender() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/logs`);
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        const data = await res.json();
        renderLogs(data.events || []);
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