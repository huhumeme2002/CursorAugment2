
// =====================
// METRICS DASHBOARD
// =====================

let metricsRefreshInterval = null;

window.refreshMetrics = async function () {
    try {
        const response = await fetch(`${API_BASE}/admin/metrics`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            console.error('Failed to fetch metrics:', response.status);
            return;
        }

        const data = await response.json();
        const metrics = data.metrics;

        // Update last refresh time
        const now = new Date();
        document.getElementById('metricsLastUpdate').textContent = `Last updated: ${now.toLocaleTimeString()}`;

        // Update quick stats cards
        document.getElementById('metricsTotalRequests').textContent = metrics.requests.total.toLocaleString();
        document.getElementById('metricsSuccessRate').textContent = metrics.requests.successRate;
        document.getElementById('metricsAvgLatency').textContent = Math.round(metrics.latency.avg) + 'ms';
        document.getElementById('metricsCacheHitRate').textContent = metrics.cache.hitRate;

        // Update latency percentiles
        const maxLatency = Math.max(metrics.latency.p99, 200); // Min scale 200ms
        document.getElementById('metricsP50Value').textContent = Math.round(metrics.latency.p50) + 'ms';
        document.getElementById('metricsP95Value').textContent = Math.round(metrics.latency.p95) + 'ms';
        document.getElementById('metricsP99Value').textContent = Math.round(metrics.latency.p99) + 'ms';

        // Update progress bars
        document.getElementById('metricsP50Bar').style.width = `${(metrics.latency.p50 / maxLatency) * 100}%`;
        document.getElementById('metricsP95Bar').style.width = `${(metrics.latency.p95 / maxLatency) * 100}%`;
        document.getElementById('metricsP99Bar').style.width = `${(metrics.latency.p99 / maxLatency) * 100}%`;

        // Update min/max/samples
        document.getElementById('metricsMinLatency').textContent = Math.round(metrics.latency.min) + 'ms';
        document.getElementById('metricsMaxLatency').textContent = Math.round(metrics.latency.max) + 'ms';
        document.getElementById('metricsLatencySamples').textContent = metrics.latency.samples;

        // Update system info
        document.getElementById('metricsUptime').textContent = metrics.uptime.minutes + 'm';
        document.getElementById('metricsTotalErrors').textContent = metrics.errors.total;
        document.getElementById('metricsSuccessCount').textContent = metrics.requests.success;
        document.getElementById('metricsErrorCount').textContent = metrics.requests.errors;

        // Update cache performance
        document.getElementById('metricsCacheHits').textContent = metrics.cache.hits.toLocaleString();
        document.getElementById('metricsCacheMisses').textContent = metrics.cache.misses.toLocaleString();
        document.getElementById('metricsCacheHitRateDetail').textContent = metrics.cache.hitRate;

        const totalCache = metrics.cache.hits + metrics.cache.misses;
        const hitPercent = totalCache > 0 ? (metrics.cache.hits / totalCache) * 100 : 0;
        const missPercent = totalCache > 0 ? (metrics.cache.misses / totalCache) * 100 : 0;

        document.getElementById('metricsCacheHitsBar').style.width = `${hitPercent}%`;
        document.getElementById('metricsCacheMissesBar').style.width = `${missPercent}%`;

        // Update error breakdown
        const errorBreakdown = document.getElementById('metricsErrorBreakdown');
        if (Object.keys(metrics.errors.byType).length === 0) {
            errorBreakdown.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">No errors recorded</p>';
        } else {
            errorBreakdown.innerHTML = Object.entries(metrics.errors.byType).map(([type, count]) => `
                <div class="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                    <span class="text-sm font-medium text-gray-700">${type}</span>
                    <span class="text-sm font-bold text-red-600">${count} errors</span>
                </div>
            `).join('');
        }

    } catch (error) {
        console.error('Error fetching metrics:', error);
    }
}

// Start auto-refresh when metrics tab is opened
window.startMetricsAutoRefresh = function () {
    if (metricsRefreshInterval) {
        clearInterval(metricsRefreshInterval);
    }
    // Refresh every 30 seconds
    metricsRefreshInterval = setInterval(refreshMetrics, 30000);
}

// Stop auto-refresh when leaving metrics tab
window.stopMetricsAutoRefresh = function () {
    if (metricsRefreshInterval) {
        clearInterval(metricsRefreshInterval);
        metricsRefreshInterval = null;
    }
}
