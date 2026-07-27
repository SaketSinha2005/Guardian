// Point this at your backend's NodePort URL (or wherever it's actually reachable from).
// This is the one thing that has to be configured somewhere - everything else below
// is driven entirely by whatever the API returns, nothing else is hardcoded.
const API_BASE_URL = 'http://192.168.49.2:30080';
const POLL_INTERVAL_MS = 30000; // matches audit-collect.py's own 60s scan cycle - no point polling faster than the data actually changes

const container = document.getElementById('log-container');

// Which cards are expanded, keyed by the event's unique auditID. This survives
// re-renders (unlike a DOM class), so polling every 3s doesn't collapse
// whatever the user just clicked open.
const expandedAuditIds = new Set();

function toggleExpand(auditId) {
    if (expandedAuditIds.has(auditId)) {
        expandedAuditIds.delete(auditId);
    } else {
        expandedAuditIds.add(auditId);
    }
    renderLogs(lastRenderedLogs);
}

let lastRenderedLogs = [];

function classifyVerb(verb) {
    if (['create', 'update', 'patch'].includes(verb)) return 'action-pill-create';
    if (verb === 'delete') return 'action-pill-delete';
    return 'action-pill-get';
}

function formatResource(objectRef) {
    if (!objectRef) return 'unknown';
    const kind = objectRef.resource || 'resource';
    // naive singularize + capitalize just for display, e.g. "pods" -> "Pod"
    const singular = kind.endsWith('s') ? kind.slice(0, -1) : kind;
    const label = singular.charAt(0).toUpperCase() + singular.slice(1);
    return objectRef.name ? `${label}/${objectRef.name}` : label;
}

function formatTimestamp(event) {
    const raw = event.stageTimestamp || event.requestReceivedTimestamp || '';
    if (!raw) return '';
    // "2026-07-27T03:26:57.123456Z" -> "2026-07-27 03:26:57"
    return raw.replace('T', ' ').substring(0, 19);
}

/**
 * Turn one raw audit event (exactly as returned by /api/logs) into the
 * shape the card renderer needs. No fields are invented - anything not
 * present in the event is shown as "unknown" rather than faked.
 */
function toDisplayLog(event) {
    const verb = event.verb || 'unknown';
    const user = (event.user && event.user.username) || 'unknown-user';
    const decision = (event.annotations && event.annotations['authorization.k8s.io/decision']) || 'unknown';

    return {
        auditId: event.auditID || JSON.stringify(event), // fallback key if auditID is ever missing
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
    // escape backticks/quotes so the auditId can safely sit inside an inline onclick string
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
        container.innerHTML = `<div class="p-6 text-on-surface-variant font-body-md text-body-md">No events yet.</div>`;
        return;
    }
    container.innerHTML = logs.map(createLogCardHTML).join('');
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
        container.innerHTML = `<div class="p-6 text-error font-body-md text-body-md">Could not reach backend at ${API_BASE_URL}. Is it running and reachable?</div>`;
    }
}

fetchAndRender();
setInterval(fetchAndRender, POLL_INTERVAL_MS);