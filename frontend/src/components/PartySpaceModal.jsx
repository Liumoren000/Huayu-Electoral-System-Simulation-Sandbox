import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { runPartySpace } from '../services/api.js';

const AXES = {
  economic: '经济立场（国家干预↔市场自由）',
  social: '社会立场（传统集体↔现代个人）',
  regional: '区域立场（本土内陆↔国际化沿海）',
  welfare: '福利立场（低福利↔高福利再分配）',
  environment: '环境立场（发展优先↔环保优先）',
  nationalism: '民族立场（国际主义↔民族主义）',
  urban_rural: '城乡立场（农村利益↔城市利益）',
};

const TOP_COLORS = { '工人联合阵线': '#e57373', '内陆发展党': '#ffb74d' };

export default function PartySpaceModal({ config, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [partyId, setPartyId] = useState('');
  const [axis, setAxis] = useState('economic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const load = async (pid, ax) => {
    if (!pid) return;
    setLoading(true);
    setError('');
    try {
      const res = await runPartySpace({
        year,
        config,
        parties,
        party_id: pid,
        axis: ax,
        step: 0.25,
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
      load(top.id, axis);
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
          const raw = p.data.raw;
          return `<b>${AXES[data.axis]}</b><br/>立场 ${raw.position} · 得票 ${(raw.vote_share * 100).toFixed(1)}% · ${raw.seats} 席<br/>首党: ${raw.top_party_name}${raw.majority ? '（过半）' : ''}`;
        },
      },
      legend: { data: ['席位响应曲线', '得票率'], textStyle: { color: '#c9d1d9', fontSize: 11 }, top: 4 },
      grid: { left: 48, right: 44, top: 40, bottom: 44 },
      xAxis: {
        type: 'value',
        name: AXES[data.axis],
        min: -1,
        max: 1,
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: [
        {
          type: 'value',
          name: '席位',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: { color: '#8b949e' },
          splitLine: { lineStyle: { color: '#21262d' } },
          min: 0,
        },
        {
          type: 'value',
          name: '得票率 %',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: { color: '#8b949e', formatter: v => `${v}%` },
          splitLine: { show: false },
          max: 45,
        },
      ],
      series: [
        {
          type: 'line',
          name: '席位响应曲线',
          yAxisIndex: 0,
          data: data.points.map(p => ({ value: p.position, raw: p })),
          symbolSize: 6,
          lineStyle: { color, width: 2.5 },
          itemStyle: { color },
        },
        {
          type: 'line',
          name: '得票率',
          yAxisIndex: 1,
          data: data.points.map(p => [+(p.vote_share * 100).toFixed(2), p]),
          symbolSize: 5,
          lineStyle: { color: '#ffd54f', width: 2, type: 'dashed' },
          itemStyle: { color: '#ffd54f' },
        },
      ],
    });
    return () => chart.dispose();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [data, parties]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>政党空间竞争 · Downsian 空间博弈</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>目标政党:</label>
            <select
              value={partyId}
              onChange={e => { setPartyId(e.target.value); load(e.target.value, axis); }}
              style={{
                background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: 4, padding: '3px 8px', fontSize: 12,
              }}
            >
              {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>扫描维度:</label>
            <select
              value={axis}
              onChange={e => { setAxis(e.target.value); load(partyId, e.target.value); }}
              style={{
                background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: 4, padding: '3px 8px', fontSize: 12,
              }}
            >
              {Object.entries(AXES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {loading && <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>计算中...</span>}
            {error && <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>{error}</span>}
          </div>

          {data && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              当前基准 {data.base_position} · <b style={{ color: 'var(--text-primary)' }}>{data.base_seats} 席</b>（得票
              {(data.base_vote_share * 100).toFixed(1)}%）。
              最优回报点：{data.optimal_position} → <b style={{ color: 'var(--accent-green)' }}>{data.optimal_seats} 席</b>。
              空间竞争理论（Downs）：政党向选民偏好中心移动可获得更多选票，但极端选民被对手争夺——曲线揭示「立场→选举回报」的非对称性。
            </div>
          )}

          <div ref={chartRef} style={{ width: '100%', height: 300 }} />

          {data && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                立场 → 选举回报
              </div>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '2px 6px' }}>立场</th>
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>得票率</th>
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>席位</th>
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>首党</th>
                  </tr>
                </thead>
                <tbody>
                  {data.points.map(p => (
                    <tr key={p.position} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '2px 6px', color: 'var(--text-primary)' }}>{p.position}</td>
                      <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>
                        {(p.vote_share * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>
                        {p.seats}
                      </td>
                      <td style={{ padding: '2px 6px', textAlign: 'right', color: TOP_COLORS[p.top_party_name] || 'var(--text-muted)' }}>
                        {p.top_party_name}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}