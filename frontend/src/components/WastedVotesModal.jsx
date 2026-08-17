import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { runWastedVotes } from '../services/api.js';

export default function WastedVotesModal({ config, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      setLoading(true);
      try {
        const res = await runWastedVotes({ year, config, parties });
        if (!disposed) setData(res);
      } catch (e) {
        if (!disposed) setError(e.message);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => { disposed = true; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  useEffect(() => {
    if (!chartRef.current || !data) return;
    const chart = echarts.init(chartRef.current);
    const cur = data.current;
    const rows = cur.parties;
    const curLabel = cur.system_type;
    chart.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const idx = ps[0].dataIndex;
          const row = rows[idx];
          const prRow = data.pr.parties[idx];
          return `<b>${row.party_name}</b><br/>` +
            `${curLabel} 浪费票 ${(row.wasted_share * 100).toFixed(1)}%（${(row.wasted_votes / 1e8).toFixed(1)}亿）<br/>` +
            `PR 浪费票 ${(prRow.wasted_share * 100).toFixed(1)}%`;
        },
      },
      legend: {
        data: [`${curLabel} 浪费票`, 'PR 浪费票'],
        textStyle: { color: '#c9d1d9', fontSize: 11 },
        top: 4,
      },
      grid: { left: 46, right: 24, top: 38, bottom: 30 },
      xAxis: {
        type: 'category',
        data: rows.map(r => r.party_name),
        axisLabel: { color: '#8b949e', fontSize: 10, rotate: 30, interval: 0 },
        axisLine: { lineStyle: { color: '#8b949e' } },
      },
      yAxis: {
        type: 'value',
        name: '浪费票占全国总票 %',
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e', formatter: v => (v * 100).toFixed(0) },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        {
          name: `${curLabel} 浪费票`,
          type: 'bar',
          data: rows.map(r => +(r.wasted_share * 100).toFixed(2)),
          itemStyle: { color: '#ff7043' },
        },
        {
          name: 'PR 浪费票',
          type: 'bar',
          data: data.pr.parties.map(r => +(r.wasted_share * 100).toFixed(2)),
          itemStyle: { color: '#4fc3f7' },
        },
      ],
    });
    return () => chart.dispose();
  }, [data]);

  const cur = data?.current;
  const rows = cur?.parties || [];

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>浪费票分析 · Wasted Votes</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>计算中...</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{error}</div>}
          {data && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                多数制下投给失败候选人的票 + 赢家超出次席的盈余票均为浪费票：
                <b style={{ color: 'var(--accent-orange)' }}> {cur.system_type} 共 {(cur.total_wasted_share * 100).toFixed(1)}%</b> 的选票未转化为议席；
                比例制（PR）下仅未过门槛政党的票浪费：<b style={{ color: 'var(--accent-blue)' }}>
                  {(data.pr.total_wasted_share * 100).toFixed(1)}%</b>。这是「胜者全得」制度效能的量化代价。
              </div>
              <div ref={chartRef} style={{ width: '100%', height: 280 }} />
              {rows.length > 0 && (
                <table className="analysis-table" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>政党</th>
                      <th>{cur.system_type} 浪费票</th>
                      <th>{cur.system_type} 浪费占比</th>
                      <th>其中赢家盈余</th>
                      <th>PR 浪费票</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const prRow = data.pr.parties[i] || {};
                      return (
                        <tr key={r.party_id}>
                          <td><span className="coal-dot" style={{ background: r.color }} /> {r.party_name}</td>
                          <td>{(r.wasted_votes / 1e8).toFixed(1)} 亿</td>
                          <td>{(r.wasted_share * 100).toFixed(1)}%</td>
                          <td style={{ color: 'var(--text-muted)' }}>{(r.surplus_share * 100).toFixed(1)}%</td>
                          <td style={{ color: 'var(--accent-blue)' }}>{(prRow.wasted_votes || 0) / 1e8 > 0 ? `${((prRow.wasted_votes || 0) / 1e8).toFixed(1)} 亿` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}