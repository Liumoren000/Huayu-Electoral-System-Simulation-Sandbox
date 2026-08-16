import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { runIssueOwnership } from '../services/api.js';

export default function IssueOwnershipModal({ config, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await runIssueOwnership({ year, config, parties });
        setData(res);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [parties, year]);

  useEffect(() => {
    if (!chartRef.current || !data) return;
    const chart = echarts.init(chartRef.current);
    const dims = data.dimensions;
    const cats = dims.map(d => d.label);
    const colors = ['#e57373', '#ffb74d', '#fff176', '#aed581', '#4fc3f7', '#b39ddb', '#f48fb1'];

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const d = dims[ps[0].dataIndex];
          const owner = d.owner_party_name;
          const margin = (d.margin * 100).toFixed(1);
          return `<b>${d.label}</b><br/>${d.description}<br/>领跑者: <b>${owner}</b>（领先 ${margin}pp）`;
        },
      },
      legend: { type: 'scroll', textStyle: { color: '#c9d1d9', fontSize: 10 }, top: 4 },
      grid: { left: 46, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: cats,
        axisLabel: { color: '#8b949e', fontSize: 10 },
        axisLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: {
        type: 'value',
        name: '所有权强度',
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: data.dimensions.map((d, i) => ({
        type: 'bar',
        name: parties.find(p => p.id === d.owner_party_id)?.name || d.owner_party_name,
        data: dims.map(dm => dm.party_scores[d.owner_party_id] ?? 0),
        itemStyle: { color: colors[i % colors.length] },
      })),
    });
    return () => chart.dispose();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [data, parties]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>议题所有权 · Issue Ownership</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ fontSize: 12, color: 'var(--accent-blue)' }}>计算中...</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{error}</div>}
          {data && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {data.note}。每个政策维度识别「被选民视为最可信赖」的政党——多数制的议题领跑者通常赢得该维度议题冲突的主导权。
              </div>
              <div ref={chartRef} style={{ width: '100%', height: 300 }} />

              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  各维度领跑者
                </div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'left', padding: '2px 6px' }}>议题</th>
                      <th style={{ textAlign: 'left', padding: '2px 6px' }}>领跑政党</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>强度</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>领先幅度</th>
                      <th style={{ textAlign: 'left', padding: '2px 6px' }}>亚军</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dimensions.map(d => (
                      <tr key={d.dimension} style={{ borderTop: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '2px 6px', color: 'var(--text-primary)' }}>
                          {d.label}
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}> {d.description}</span>
                        </td>
                        <td style={{ padding: '2px 6px', color: 'var(--text-primary)' }}>
                          <span style={{ color: d.owner_color }}>●</span> {d.owner_party_name}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>
                          {(d.owner_score * 100).toFixed(1)}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--accent-green)' }}>
                          +{(d.margin * 100).toFixed(1)}pp
                        </td>
                        <td style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>{d.runner_up_party_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  各党议题招牌
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {data.parties.map(p => (
                    <span key={p.party_id} style={{
                      background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                      borderRadius: 4, padding: '3px 8px', fontSize: 11, color: 'var(--text-primary)',
                    }}>
                      <span style={{ color: p.color }}>●</span> {p.party_name}
                      {p.owned_count > 0 ? `：${p.owned_issues.join('、')}` : '（无专属议题）'}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}