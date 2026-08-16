import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { runPartyFreeze } from '../services/api.js';

const PARTY_COLORS = {
  '工人联合阵线': '#e57373',
  '内陆发展党': '#ffb74d',
  '传统价值守护党': '#fff176',
  '民族区域自治党': '#aed581',
  '绿色未来党': '#4fc3f7',
  '新市民进步党': '#b39ddb',
  '沿海商业联盟': '#f48fb1',
};

export default function PartyFreezeModal({ config, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await runPartyFreeze({ year, config, parties });
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
    const runs = data.runs;
    const years = runs.map(r => `${r.year}`);
    const seatKeys = Object.keys(runs[0]?.party_seats || {});
    const names = {};
    for (const r of runs) {
      for (const [pid, s] of Object.entries(r.party_seats)) {
        names[pid] = pid;
      }
    }

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const r = runs[ps[0].dataIndex];
          let lines = `<b>${r.year} ${r.era_label}</b><br/>首党: ${r.top_party_name}<br/>有效政党（席）: ${r.effective_parties_seats}`;
          for (const [pid, s] of Object.entries(r.party_seats)) {
            lines += `<br/>${parties.find(p => p.id === pid)?.name || pid}: ${s} 席`;
          }
          return lines;
        },
      },
      legend: { type: 'scroll', textStyle: { color: '#c9d1d9', fontSize: 10 }, top: 4 },
      grid: { left: 46, right: 20, top: 40, bottom: 40 },
      xAxis: {
        type: 'category',
        data: years,
        axisLabel: { color: '#8b949e', rotate: 30, fontSize: 9 },
        axisLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: {
        type: 'value',
        name: '席位',
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: seatKeys.map(pid => ({
        type: 'line',
        name: parties.find(p => p.id === pid)?.name || pid,
        data: runs.map(r => r.party_seats[pid] ?? 0),
        symbolSize: 5,
        lineStyle: { color: PARTY_COLORS[parties.find(p => p.id === pid)?.name] || '#4fc3f7', width: 2 },
        itemStyle: { color: PARTY_COLORS[parties.find(p => p.id === pid)?.name] || '#4fc3f7' },
      })),
    });
    return () => chart.dispose();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [data, parties]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>政党体系冻结度 · Lipset-Rokkan</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ fontSize: 12, color: 'var(--accent-blue)' }}>计算中...</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{error}</div>}
          {data && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                <span style={{ color: 'var(--accent-blue)' }}>冻结度 {data.freeze_index}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {' '}· 首党保持率 {data.top_party_retention}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {data.note}。Lipset-Rokkan「冻结假说」：20 世纪形成的政党格局在阶级/宗教结构性对抗下长期稳定——席位份额结构越相似、首党越持久，体系越「冻结」。
              </div>
              <div ref={chartRef} style={{ width: '100%', height: 280 }} />

              <div style={{ marginTop: 8 }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'left', padding: '2px 6px' }}>年代</th>
                      <th style={{ textAlign: 'left', padding: '2px 6px' }}>首党</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>有效政党</th>
                      <th style={{ textAlign: 'right', padding: '2px 6px' }}>Gallagher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map(r => (
                      <tr key={r.year} style={{ borderTop: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '2px 6px', color: 'var(--text-primary)' }}>
                          {r.year} {r.era_label}
                        </td>
                        <td style={{ padding: '2px 6px', color: PARTY_COLORS[r.top_party_name] || 'var(--text-primary)' }}>
                          {r.top_party_name}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>
                          {r.effective_parties_seats}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {r.gallagher}
                        </td>
                      </tr>
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