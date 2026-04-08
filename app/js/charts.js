(function () {
    const instances = new Map();

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function ensureContainer(containerOrId) {
        if (!containerOrId) return null;
        if (typeof containerOrId === "string") {
            return document.getElementById(containerOrId);
        }
        return containerOrId;
    }

    function clearContainer(container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }

    function createCanvas(container) {
        const canvas = document.createElement("canvas");
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        canvas.setAttribute("aria-hidden", "true");
        container.appendChild(canvas);
        return canvas;
    }

    function createOverlay(container) {
        const overlay = document.createElement("div");
        overlay.style.position = "absolute";
        overlay.style.left = "14px";
        overlay.style.right = "14px";
        overlay.style.top = "12px";
        overlay.style.display = "flex";
        overlay.style.justifyContent = "space-between";
        overlay.style.alignItems = "center";
        overlay.style.gap = "12px";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "2";
        container.appendChild(overlay);
        return overlay;
    }

    function createLabel(text, align) {
        const el = document.createElement("div");
        el.textContent = text || "";
        el.style.fontSize = "12px";
        el.style.fontWeight = "700";
        el.style.letterSpacing = "0.2px";
        el.style.color = "rgba(238,242,255,.88)";
        el.style.textAlign = align || "left";
        el.style.textShadow = "0 1px 1px rgba(0,0,0,.35)";
        return el;
    }

    function createEmptyState(container, message) {
        const el = document.createElement("div");
        el.className = "chart-empty";
        el.textContent = message || "No chart data available.";
        container.appendChild(el);
        return el;
    }

    function normalizeSeries(series) {
        if (!Array.isArray(series)) return [];
        return series
            .map((point, index) => {
                if (typeof point === "number") {
                    return { x: index, y: point };
                }
                if (point && typeof point === "object") {
                    return {
                        x: point.x ?? index,
                        y: Number(point.y ?? 0),
                        label: point.label ?? ""
                    };
                }
                return null;
            })
            .filter(Boolean)
            .filter((point) => Number.isFinite(point.y));
    }

    function sizeCanvas(canvas, container) {
        const rect = container.getBoundingClientRect();
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const width = Math.max(Math.floor(rect.width), 100);
        const height = Math.max(Math.floor(rect.height), 120);

        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);

        const ctx = canvas.getContext("2d");
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        return { ctx, width, height };
    }

    function drawGrid(ctx, width, height, chartArea) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.06)";
        ctx.lineWidth = 1;

        const horizontalLines = 4;
        const verticalLines = 6;

        for (let i = 0; i <= horizontalLines; i += 1) {
            const y = chartArea.top + ((chartArea.height / horizontalLines) * i);
            ctx.beginPath();
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.left + chartArea.width, y);
            ctx.stroke();
        }

        for (let i = 0; i <= verticalLines; i += 1) {
            const x = chartArea.left + ((chartArea.width / verticalLines) * i);
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.top + chartArea.height);
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawAxes(ctx, chartArea) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.14)";
        ctx.lineWidth = 1.25;

        ctx.beginPath();
        ctx.moveTo(chartArea.left, chartArea.top + chartArea.height);
        ctx.lineTo(chartArea.left + chartArea.width, chartArea.top + chartArea.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(chartArea.left, chartArea.top);
        ctx.lineTo(chartArea.left, chartArea.top + chartArea.height);
        ctx.stroke();

        ctx.restore();
    }

    function getBounds(series) {
        const ys = series.map((p) => p.y);
        let minY = Math.min(...ys);
        let maxY = Math.max(...ys);

        if (minY === maxY) {
            const pad = minY === 0 ? 1 : Math.abs(minY) * 0.1;
            minY -= pad;
            maxY += pad;
        }

        const range = maxY - minY;
        const padding = range * 0.08;

        return {
            minY: minY - padding,
            maxY: maxY + padding
        };
    }

    function drawLineChart(ctx, width, height, series, options) {
        const chartArea = {
            left: 18,
            top: 40,
            width: width - 36,
            height: height - 58
        };

        drawGrid(ctx, width, height, chartArea);
        drawAxes(ctx, chartArea);

        const { minY, maxY } = getBounds(series);
        const stepX = series.length > 1 ? chartArea.width / (series.length - 1) : chartArea.width / 2;

        const points = series.map((point, index) => {
            const x = chartArea.left + (series.length > 1 ? stepX * index : chartArea.width / 2);
            const ratioY = (point.y - minY) / (maxY - minY);
            const y = chartArea.top + chartArea.height - (ratioY * chartArea.height);
            return { x, y, value: point.y, label: point.label || "" };
        });

        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.top + chartArea.height);
        gradient.addColorStop(0, "rgba(124,156,255,.28)");
        gradient.addColorStop(1, "rgba(81,209,255,.02)");

        ctx.save();

        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.lineTo(points[points.length - 1].x, chartArea.top + chartArea.height);
        ctx.lineTo(points[0].x, chartArea.top + chartArea.height);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.strokeStyle = options.strokeColor || "#7c9cff";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        points.forEach((point) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 3.25, 0, Math.PI * 2);
            ctx.fillStyle = options.pointColor || "#51d1ff";
            ctx.fill();
            ctx.strokeStyle = "rgba(8,16,31,.75)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });

        ctx.restore();

        drawValueLabels(ctx, chartArea, minY, maxY);
    }

    function drawBarChart(ctx, width, height, series, options) {
        const chartArea = {
            left: 18,
            top: 40,
            width: width - 36,
            height: height - 58
        };

        drawGrid(ctx, width, height, chartArea);
        drawAxes(ctx, chartArea);

        const { minY, maxY } = getBounds(series);
        const usableWidth = chartArea.width;
        const gap = 10;
        const barWidth = Math.max(16, (usableWidth - (gap * (series.length - 1))) / Math.max(series.length, 1));

        ctx.save();

        series.forEach((point, index) => {
            const ratioY = (point.y - minY) / (maxY - minY);
            const barHeight = clamp(ratioY * chartArea.height, 4, chartArea.height);
            const x = chartArea.left + (index * (barWidth + gap));
            const y = chartArea.top + chartArea.height - barHeight;

            const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
            gradient.addColorStop(0, options.barColorTop || "rgba(81,209,255,.95)");
            gradient.addColorStop(1, options.barColorBottom || "rgba(124,156,255,.55)");

            roundRect(ctx, x, y, barWidth, barHeight, 8);
            ctx.fillStyle = gradient;
            ctx.fill();
        });

        ctx.restore();

        drawValueLabels(ctx, chartArea, minY, maxY);
    }

    function drawValueLabels(ctx, chartArea, minY, maxY) {
        ctx.save();
        ctx.fillStyle = "rgba(158,168,199,.8)";
        ctx.font = "12px Arial, Helvetica, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        const steps = 4;
        for (let i = 0; i <= steps; i += 1) {
            const value = maxY - (((maxY - minY) / steps) * i);
            const y = chartArea.top + ((chartArea.height / steps) * i);
            ctx.fillText(formatCompactNumber(value), chartArea.left + 6, y - 8);
        }

        ctx.restore();
    }

    function formatCompactNumber(value) {
        const abs = Math.abs(value);

        if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
        if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
        if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
        if (abs >= 1) return `${value.toFixed(2)}`;
        return `${value.toFixed(4)}`;
    }

    function roundRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function renderChart(containerOrId, config) {
        const container = ensureContainer(containerOrId);
        if (!container) return null;

        const chartConfig = {
            type: config?.type || "line",
            title: config?.title || "",
            subtitle: config?.subtitle || "",
            emptyMessage: config?.emptyMessage || "No chart data available.",
            series: normalizeSeries(config?.series || []),
            strokeColor: config?.strokeColor,
            pointColor: config?.pointColor,
            barColorTop: config?.barColorTop,
            barColorBottom: config?.barColorBottom
        };

        clearContainer(container);
        container.classList.add("chart-shell");
        container.style.position = "relative";

        if (!chartConfig.series.length) {
            createEmptyState(container, chartConfig.emptyMessage);
            return null;
        }

        const canvas = createCanvas(container);
        const overlay = createOverlay(container);
        const leftLabel = createLabel(chartConfig.title, "left");
        const rightLabel = createLabel(chartConfig.subtitle, "right");
        overlay.appendChild(leftLabel);
        overlay.appendChild(rightLabel);

        function draw() {
            const sized = sizeCanvas(canvas, container);
            const ctx = sized.ctx;
            const width = sized.width;
            const height = sized.height;

            ctx.clearRect(0, 0, width, height);

            if (chartConfig.type === "bar") {
                drawBarChart(ctx, width, height, chartConfig.series, chartConfig);
            } else {
                drawLineChart(ctx, width, height, chartConfig.series, chartConfig);
            }
        }

        draw();

        const instance = {
            container,
            canvas,
            config: chartConfig,
            draw
        };

        instances.set(container, instance);
        return instance;
    }

    function updateChart(containerOrId, config) {
        return renderChart(containerOrId, config);
    }

    function resizeAllCharts() {
        instances.forEach((instance) => {
            if (instance && typeof instance.draw === "function") {
                instance.draw();
            }
        });
    }

    function generateSeries(count, min, max, decimals) {
        const length = Math.max(count || 12, 2);
        const out = [];
        let current = min + ((max - min) * 0.45);

        for (let i = 0; i < length; i += 1) {
            const drift = (Math.random() - 0.45) * ((max - min) * 0.18);
            current = clamp(current + drift, min, max);
            out.push({
                x: i,
                y: Number(current.toFixed(decimals ?? 2))
            });
        }

        return out;
    }

    function seedDemoCharts() {
        if (document.getElementById("homePriceChart")) {
            renderChart("homePriceChart", {
                type: "line",
                title: "ATOM / TOKEN",
                subtitle: "Demo Price",
                emptyMessage: "No home price data yet.",
                series: generateSeries(20, 1.1, 1.9, 4)
            });
        }

        if (document.getElementById("homeLiquidityChart")) {
            renderChart("homeLiquidityChart", {
                type: "bar",
                title: "Liquidity Depth",
                subtitle: "Demo Pool",
                emptyMessage: "No liquidity chart data yet.",
                series: generateSeries(12, 12000, 38000, 0)
            });
        }

        if (document.getElementById("marketsPriceChart")) {
            renderChart("marketsPriceChart", {
                type: "line",
                title: "Primary Market",
                subtitle: "24H View",
                emptyMessage: "No markets price data yet.",
                series: generateSeries(24, 0.85, 1.65, 4)
            });
        }

        if (document.getElementById("marketsLiquidityChart")) {
            renderChart("marketsLiquidityChart", {
                type: "bar",
                title: "Pool Depth",
                subtitle: "Reserve View",
                emptyMessage: "No markets liquidity data yet.",
                series: generateSeries(10, 18000, 62000, 0)
            });
        }

        if (document.getElementById("dashboardPortfolioChart")) {
            renderChart("dashboardPortfolioChart", {
                type: "line",
                title: "Portfolio",
                subtitle: "Demo Value",
                emptyMessage: "No portfolio chart data yet.",
                series: generateSeries(18, 2400, 4100, 0)
            });
        }

        if (document.getElementById("dashboardMarketChart")) {
            renderChart("dashboardMarketChart", {
                type: "line",
                title: "Selected Market",
                subtitle: "Demo Trend",
                emptyMessage: "No market chart data yet.",
                series: generateSeries(18, 0.9, 1.8, 4)
            });
        }

        if (document.getElementById("liquidityReserveChart")) {
            renderChart("liquidityReserveChart", {
                type: "bar",
                title: "Reserve Composition",
                subtitle: "Demo Pool",
                emptyMessage: "No reserve chart data yet.",
                series: generateSeries(8, 15000, 47000, 0)
            });
        }

        if (document.getElementById("liquidityHistoryChart")) {
            renderChart("liquidityHistoryChart", {
                type: "line",
                title: "LP Position History",
                subtitle: "Demo",
                emptyMessage: "No LP history data yet.",
                series: generateSeries(16, 800, 2200, 0)
            });
        }

        if (document.getElementById("activityTimelineChart")) {
            renderChart("activityTimelineChart", {
                type: "line",
                title: "Transaction Timeline",
                subtitle: "Demo Activity",
                emptyMessage: "No timeline chart data yet.",
                series: generateSeries(18, 2, 14, 0)
            });
        }

        if (document.getElementById("activityMixChart")) {
            renderChart("activityMixChart", {
                type: "bar",
                title: "Activity Mix",
                subtitle: "Demo Events",
                emptyMessage: "No activity mix chart data yet.",
                series: generateSeries(6, 1, 12, 0)
            });
        }
    }

    function initCharts() {
        seedDemoCharts();
    }

    window.CosmosDexCharts = {
        initCharts,
        renderChart,
        updateChart,
        resizeAllCharts,
        generateSeries
    };

    window.addEventListener("resize", resizeAllCharts);
    window.addEventListener("DOMContentLoaded", initCharts);
})();