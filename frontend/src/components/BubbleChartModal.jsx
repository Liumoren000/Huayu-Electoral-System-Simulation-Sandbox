import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function BubbleChartModal({ resultA, resultB, activeScheme, onClose }) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);

    const buildSeries = (result, schemeLabel, hollow) => {
      const data = (result?.party_results || []).map(p => ({
        value: [
          +(p.vote_share * 100).toFixed(2),
          +((p.seats / Math.max(1, result.total_seats)) * 100).toFixed(2),
          p.seats,
        ],
        name: p.party_name,
        itemStyle: { color: p.color },
        ...(hollow ? { symbol: 'circle' } : {}),
      }));
      return {
        name: schemeLabel,
        type: 'scatter',
        symbolSize: d => Math.max(8, Math.min(46, d[2] * 0.4)),
        data,
        emphasis: { label: { show: true, fontSize: 11, color: '#e8eaed' } },
        ...(hollow ? {
          symbol: 'circle',
        } : {}),
      };
    };

    const series = [];
    const both = resultA && resultB;
    series.push(buildSeries(activeScheme === 'B' && resultB ? resultB : resultA, activeScheme === 'B' && resultB ? '方案B' : '当前方案', false));
    if (both) {
      const other = activeScheme === 'B' ? resultA : resultB;
      series.push(buildSeries(other, activeScheme === 'B' ? '方案A' : '方案B', true));
    }

    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: p => `${p.seriesName}<br/><b>${p.name}</b><br/>选票 ${p.value[0]}% · 席位 ${p.value[1]}% · ${p.value[2]}席`,
      },
      legend: {
        data: series.map(s => s.name),
        textStyle: { color: '#c9d1d9', fontSize: 11 },
        top: 4,
      },
      grid: { left: 60, right: 40, top: 40, bottom: 40 },
      xAxis: {
        type: 'value',
        name: '选票份额 %',
        min: 0,
        max: (v) => Math.ceil(v.max / 10) * 10 || 50,
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: {
        type: 'value',
        name: '席位份额 %',
        min: 0,
        max: (v) => Math.ceil(v.max / 10) * 10 || 50,
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        ...series,
        {
          name: '比例线 (席=票)',
          type: 'line',
          data: [[8, 8], [38, 38]],
          lineStyle: { color: '#5a6378', type: 'dashed', width: 1 },
          symbol: 'none',
          silent: true,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [resultA, resultB, activeScheme]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>席位—选票偏差气泡图</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div ref={chartRef} style={{ width: '100%', height: 380 }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.7 }}>
            气泡 = 政党（面积=席位数），横轴选票份额、纵轴席位份额，虚线为完全比例线。
            位于虚线上方的政党获得「胜者红利」，下方则是「败者惩罚」。
            {resultA && resultB && ' 实心为当前方案，空心为另一方案，可直接对比制度的偏差方向。'}
          </div>
        </div>
      </div>
    </div>
  );
}