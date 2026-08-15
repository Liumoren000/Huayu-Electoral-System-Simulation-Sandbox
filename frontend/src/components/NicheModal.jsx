import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function NicheModal({ result, onClose }) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const niches = result?.party_niches || [];

    const data = niches.map(n => ({
      value: [n.economic_position, n.social_position, n.vote_share * 100],
      name: n.party_name,
      itemStyle: { color: n.color },
    }));

    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: p => {
          const n = niches.find(x => x.party_name === p.name);
          const top = n && n.overlaps ? Object.entries(n.overlaps).sort((a, b) => b[1] - a[1])[0] : null;
          const topName = top ? (result.party_results.find(pr => pr.party_id === top[0])?.party_name || '') : '';
          return `<b>${p.name}</b><br/>得票 ${p.value[2].toFixed(1)}%<br/>经济 ${p.value[0].toFixed(2)} · 社会 ${p.value[1].toFixed(2)}<br/>生态位宽 ${n?.niche_width?.toFixed(3) ?? '-'} · 覆盖 ${((n?.coverage ?? 0) * 100).toFixed(0)}%<br/>最大重叠 ${(top?.[1] ?? 0).toFixed(2)}（${topName}）`;
        },
      },
      grid: { left: 55, right: 30, top: 35, bottom: 40 },
      xAxis: {
        type: 'value',
        name: '经济立场（-干预 ↔ +市场）',
        min: -1,
        max: 1,
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
        axisLine: { lineStyle: { color: '#8b949e' } },
      },
      yAxis: {
        type: 'value',
        name: '社会立场（-传统 ↔ +现代）',
        min: -1,
        max: 1,
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
        axisLine: { lineStyle: { color: '#8b949e' } },
      },
      series: [{
        type: 'scatter',
        symbolSize: d => Math.max(12, Math.min(70, d[2] * 1.8)),
        data,
        label: { show: true, position: 'top', formatter: p => p.name, color: '#e8eaed', fontSize: 10 },
        emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
      }],
    });
    return () => chart.dispose();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [result]);

  const niches = (result?.party_niches || []).slice().sort((a, b) => b.vote_share - a.vote_share);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>政党生态位空间</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div ref={chartRef} style={{ width: '100%', height: 380 }} />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            气泡位置 = 政党纲领立场（经济 × 社会），气泡大小 = 得票率。生态位宽度衡量覆盖范围，重叠度衡量两党选民基础的重合（竞争激烈程度）。
          </div>
          {niches.length > 0 && (
            <table className="analysis-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>政党</th>
                  <th>得票</th>
                  <th>生态位宽</th>
                  <th>覆盖</th>
                  <th>最大重叠党</th>
                  <th>重叠度</th>
                </tr>
              </thead>
              <tbody>
                {niches.map(n => {
                  const top = Object.entries(n.overlaps || {}).sort((a, b) => b[1] - a[1])[0];
                  const topName = top ? (result.party_results.find(pr => pr.party_id === top[0])?.party_name || '') : '-';
                  return (
                    <tr key={n.party_id}>
                      <td>
                        <span className="coal-dot" style={{ background: n.color }} /> {n.party_name}
                      </td>
                      <td>{(n.vote_share * 100).toFixed(1)}%</td>
                      <td>{n.niche_width.toFixed(3)}</td>
                      <td>{((n.coverage || 0) * 100).toFixed(0)}%</td>
                      <td>{topName}</td>
                      <td style={{ color: (top?.[1] ?? 0) > 0.6 ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                        {(top?.[1] ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}