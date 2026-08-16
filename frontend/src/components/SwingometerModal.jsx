import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { runSwingometer } from '../services/api.js';

export default function SwingometerModal({ config, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [partyId, setPartyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const load = async (pid) => {
    if (!pid) return;
    setLoading(true);
    setError('');
    try {
      const res = await runSwingometer({
        year,
        config,
        parties,
        party_id: pid,
        max_swing: 12,
        step: 1,
      });
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (parties?.length && !partyId) {
      const top = [...parties].sort((a, b) => (b.name === '工人联合阵线') - (a.name === '工人联合阵线'))[0];
      setPartyId(top.id);
      load(top.id);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [parties]);

  useEffect(() => {
    if (!chartRef.current || !data) return;
    const chart = echarts.init(chartRef.current);
    const party = parties.find(p => p.id === data.party_id);
    const color = party?.color || '#4fc3f7';

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const p = ps[0];
          return `<b>${p.name}</b><br/>席位 ${p.value[1]} / ${data.total_seats}<br/>得票率 ${(p.value[0] * 100).toFixed(1)}%`;
        },
      },
      legend: { data: ['席位-选票曲线'], textStyle: { color: '#c9d1d9', fontSize: 11 }, top: 4 },
      grid: { left: 52, right: 44, top: 40, bottom: 44 },
      xAxis: {
        type: 'value',
        name: '全国得票率 %',
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e', formatter: v => (v * 100).toFixed(0) },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: {
        type: 'value',
        name: '席位',
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
        min: 0,
        max: Math.ceil(Math.max(...data.points.map(p => p.seats)) / 10) * 10 || 50,
      },
      series: [{
        type: 'line',
        name: '席位-选票曲线',
        data: data.points.map(p => [+(p.vote_share * 100).toFixed(2), p.seats, p]),
        symbolSize: 5,
        lineStyle: { color, width: 2.5 },
        itemStyle: { color },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { color: '#8b949e', fontSize: 10, formatter: '过半线 226 席' },
          lineStyle: { color: '#e53935', type: 'dashed', width: 1 },
          data: [{ yAxis: data.total_seats / 2 }],
        },
      }],
    });
    return () => chart.dispose();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [data, parties]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>统一摆动分析 · Swingometer</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>目标政党:</label>
            <select
              value={partyId}
              onChange={e => { setPartyId(e.target.value); load(e.target.value); }}
              style={{
                background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: 4, padding: '3px 8px', fontSize: 12,
              }}
            >
              {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {loading && <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>计算中...</span>}
            {error && <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>{error}</span>}
          </div>

          {data && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              {partyId && parties.find(p => p.id === partyId)?.name} 当前基准：<b style={{ color: 'var(--text-primary)' }}>{data.base_seats} 席</b>（得票 {(data.base_vote_share * 100).toFixed(1)}%）。
              曲线向上凸起表明多数制对选票摆动的非线性放大——小幅选票变化即可换来不成比例的席位波动。
            </div>
          )}

          <div ref={chartRef} style={{ width: '100%', height: 300 }} />

          {data && data.flip_points && data.flip_points.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                席位翻转阈值（相对基准 ±{data.base_seats}席）
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.flip_points.slice(0, 6).map(f => (
                  <span key={f.swing_pp} style={{
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                    borderRadius: 4, padding: '2px 8px', fontSize: 11, color: 'var(--text-primary)',
                  }}>
                    {f.swing_pp > 0 ? '+' : ''}{f.swing_pp}pp → {f.seats} 席
                    <span style={{ color: f.delta_seats > 0 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                      {' '}({f.delta_seats > 0 ? '+' : ''}{f.delta_seats})
                    </span>
                  </span>
                ))}
              </div>
              {data.majority_point && (
                <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 6 }}>
                  过半数阈值：{data.majority_point.swing_pp > 0 ? '+' : ''}{data.majority_point.swing_pp}pp 摆动时达到 {data.majority_point.seats} 席（过半），得票率 {(data.majority_point.vote_share * 100).toFixed(1)}%。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}