import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { runDistrictMagnitude } from '../services/api.js';

export default function DistrictMagnitudeModal({ config, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await runDistrictMagnitude({ year, config, parties });
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
    const results = data.results.filter(r => !r.error);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const r = results[ps[0].dataIndex];
          return `<b>每选区 ${r.magnitude} 席</b><br/>有效政党（席位）: ${r.effective_parties_seats}<br/>首党: ${r.top_party_name} ${r.top_seats} 席（${(r.top_vote * 100).toFixed(1)}%）<br/>比例性偏差（Gallagher）: ${r.gallagher}`;
        },
      },
      legend: { textStyle: { color: '#c9d1d9', fontSize: 11 }, top: 4 },
      grid: { left: 46, right: 44, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: results.map(r => `${r.magnitude} 席`),
        name: '选区规模（每选区议席数）',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: '#8b949e', fontSize: 10 },
        axisLabel: { color: '#8b949e' },
        axisLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: [
        {
          type: 'value',
          name: '有效政党数',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: { color: '#8b949e' },
          splitLine: { lineStyle: { color: '#21262d' } },
          min: 0,
        },
        {
          type: 'value',
          name: '首党席位',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: { color: '#8b949e' },
          splitLine: { show: false },
          min: 0,
        },
      ],
      series: [
        {
          type: 'line',
          name: '有效政党数（席位）',
          data: results.map(r => r.effective_parties_seats),
          symbolSize: 7,
          lineStyle: { color: '#4fc3f7', width: 2.5 },
          itemStyle: { color: '#4fc3f7' },
        },
        {
          type: 'line',
          name: '首党席位',
          yAxisIndex: 1,
          data: results.map(r => r.top_seats),
          symbolSize: 7,
          lineStyle: { color: '#e57373', width: 2.5 },
          itemStyle: { color: '#e57373' },
        },
      ],
    });
    return () => chart.dispose();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [data]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>选区规模效应 · District Magnitude</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ fontSize: 12, color: 'var(--accent-blue)' }}>计算中...</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{error}</div>}
          {data && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Duverger 定律选区推论：单议席选区压制小党、形成两党制；多议席选区（STV）降低进入门槛，碎片化加剧。上表为同一选民偏好下、仅改变每选区议席数（magnitude）的重跑对比。
              </div>
              <div ref={chartRef} style={{ width: '100%', height: 280 }} />

              <div style={{ marginTop: 8 }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'left', padding: '2px 6px' }}>选区规模</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>有效政党（票）</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>有效政党（席）</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>首党席位</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>比例偏差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map(r => (
                      r.error ? null : (
                        <tr key={r.magnitude} style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '2px 6px', color: 'var(--text-primary)' }}>
                            {r.magnitude} 席/选区
                          </td>
                          <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>
                            {r.effective_parties_vote}
                          </td>
                          <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--accent-blue)' }}>
                            {r.effective_parties_seats}
                          </td>
                          <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>
                            {r.top_party_name} {r.top_seats}
                          </td>
                          <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                            {r.gallagher}
                          </td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}