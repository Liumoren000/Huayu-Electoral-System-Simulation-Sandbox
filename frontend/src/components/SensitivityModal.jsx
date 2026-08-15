import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { runSensitivity } from '../services/api.js';

const PARAMS = {
  threshold: { label: '得票门槛', fmt: v => (v * 100).toFixed(0) + '%' },
  mixed_ratio: { label: '名单席占比', fmt: v => (v * 100).toFixed(0) + '%' },
  noise_amplitude: { label: '选民噪声', fmt: v => (v * 100).toFixed(1) + '%' },
  voter_samples: { label: '抽样选民数', fmt: v => String(Math.round(v)) },
  urban_rural_weight: { label: '城乡投票差异权重', fmt: v => (v * 100).toFixed(0) + '%' },
};

const METRICS = [
  { key: 'gallagher', label: 'Gallagher 指数', fmt: v => v.toFixed(3) },
  { key: 'effective_parties_seats', label: '有效政党数(席)', fmt: v => v.toFixed(2) },
  { key: 'majority_rate', label: '过半率', fmt: v => (v * 100).toFixed(0) + '%' },
  { key: 'largest_party_seats', label: '最大党席位', fmt: v => v.toFixed(1) },
];

export default function SensitivityModal({ year, config, totalSeats, minSeats, parties, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [metric, setMetric] = useState('gallagher');
  const [delta, setDelta] = useState(0.2);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
      const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const d = await runSensitivity({
        year,
        config: simConfig,
        parties: enabled,
        delta,
        iterations: 5,
        params: ['threshold', 'mixed_ratio', 'noise_amplitude', 'voter_samples', 'urban_rural_weight'],
      });
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!data || !chartRef.current) return;
    const meta = METRICS.find(m => m.key === metric);
    const base = data.points[0]?.baseline?.[metric] ?? 0;
    const rows = data.points.map(p => {
      const low = p.low[metric], high = p.high[metric];
      const lowD = low - base, highD = high - base;
      return {
        name: PARAMS[p.param]?.label || p.param,
        lowD, highD,
        lowV: low, highV: high, baseV: base,
      };
    }).sort((a, b) => Math.max(Math.abs(a.lowD), Math.abs(a.highD)) - Math.max(Math.abs(b.lowD), Math.abs(b.highD)));
    const fmt = meta.fmt;
    const chart = echarts.init(chartRef.current);
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        formatter: params => {
          const r = rows[params.dataIndex];
          return `<b>${r.name}</b><br/>低: ${fmt(r.lowV)}<br/>基准: ${fmt(r.baseV)}<br/>高: ${fmt(r.highV)}`;
        },
      },
      grid: { left: 90, right: 60, top: 16, bottom: 40 },
      xAxis: {
        type: 'value',
        name: `对基准(${fmt(base)})的偏差`,
        nameTextStyle: { color: '#9aa0a6', fontSize: 10 },
        axisLabel: { color: '#9aa0a6', fontSize: 10 },
      },
      yAxis: { type: 'category', data: rows.map(r => r.name), axisLabel: { color: '#9aa0a6', fontSize: 11 } },
      series: [
        {
          type: 'bar', data: rows.map(r => r.lowD), barWidth: 10,
          itemStyle: { color: 'var(--accent-blue)' },
          label: { show: true, position: 'left', color: '#9aa0a6', fontSize: 9, formatter: p => fmt(rows[p.dataIndex].lowV) },
        },
        {
          type: 'bar', data: rows.map(r => r.highD), barWidth: 10,
          itemStyle: { color: 'var(--accent-orange)' },
          label: { show: true, position: 'right', color: '#9aa0a6', fontSize: 9, formatter: p => fmt(rows[p.dataIndex].highV) },
        },
      ],
    });
    return () => chart.dispose();
  }, [data, metric]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <span style={{ fontWeight: 700 }}>单因素敏感性 (Tornado)</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>逐个参数 ±delta 扰动，识别关键杠杆</span>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 11 }}>扰动幅度 ±
              <input type="number" min="0.05" max="1" step="0.05" value={delta} onChange={e => setDelta(parseFloat(e.target.value) || 0.2)} style={{ width: 60 }} />
            </label>
            <label style={{ fontSize: 11 }}>指标
              <select value={metric} onChange={e => setMetric(e.target.value)}>
                {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <button className="run-btn" onClick={run} disabled={loading} style={{ padding: '4px 14px' }}>
              {loading ? '计算中...' : '重新计算'}
            </button>
          </div>
          {error && <div style={{ color: 'var(--accent-orange)', fontSize: 12, marginBottom: 8 }}>错误: {error}</div>}
          <div ref={chartRef} style={{ width: '100%', height: 280 }} />
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--accent-blue)', marginRight: 4 }} />参数下调 (−delta)</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--accent-orange)', marginRight: 4 }} />参数上调 (+delta)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
