import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { runRollingCount } from '../services/api.js';

export default function RollingCountModal({ config, totalSeats, minSeats, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
        const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
        const d = await runRollingCount({ config: simConfig, parties: enabled, steps: 30 });
        setData(d);
        setStepIdx(0);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  useEffect(() => {
    if (playing && data && stepIdx < data.steps.length - 1) {
      timerRef.current = setTimeout(() => setStepIdx(i => i + 1), 160);
    } else if (playing && data && stepIdx >= data.steps.length - 1) {
      setPlaying(false);
    }
    return () => clearTimeout(timerRef.current);
  }, [playing, stepIdx, data]);

  const step = data?.steps?.[stepIdx];
  const partyColors = useMemo(() => {
    const m = {};
    (parties || []).forEach(p => { m[p.id] = p.color; });
    return m;
  }, [parties]);

  const chartData = useMemo(() => {
    if (!data) return null;
    // 各党席位曲线（跨步长）
    return data.party_names;
  }, [data]);

  useEffect(() => {
    if (!data || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const partyIds = Object.keys(data.party_names || {});
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { color: '#ccc', fontSize: 10 }, top: 0 },
      grid: { left: 40, right: 16, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: data.steps.map(s => `${Math.round(s.counted / s.total * 100)}%`),
        name: '开票进度',
        axisLabel: { color: '#aaa', fontSize: 10 },
        axisLine: { lineStyle: { color: '#444' } },
      },
      yAxis: {
        type: 'value',
        name: '席位',
        axisLabel: { color: '#aaa', fontSize: 10 },
        axisLine: { lineStyle: { color: '#444' } },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      series: partyIds.map(pid => ({
        name: data.party_names[pid],
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: data.steps.map(s => s.party_seats[pid] || 0),
        lineStyle: { width: 2, color: partyColors[pid] || '#888' },
        itemStyle: { color: partyColors[pid] || '#888' },
        emphasis: { disabled: true },
      })),
    });
    return () => chart.dispose();
  }, [data, partyColors]);

  // 高亮当前步（用于竖向指引）
  useEffect(() => {
    if (!data || !chartRef.current) return;
    const chart = echarts.getInstanceByDom(chartRef.current);
    if (!chart) return;
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: stepIdx });
  }, [stepIdx, data]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>选举日 · 实时开票直播 {year}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="copy-btn" onClick={() => {
              if (stepIdx <= 0) setStepIdx(0);
              setPlaying(v => !v);
            }}>
              {playing ? '暂停' : stepIdx >= (data?.steps?.length || 1) - 1 ? '重播' : '播放'}
            </button>
            <button className="province-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>生成开票数据…</div>}
          {error && <div style={{ color: '#ff5252', padding: 20 }}>{error}</div>}
          {!loading && !error && data && step && (
            <>
              {/* 进度条 */}
              <div className="rolling-progress">
                <div className="rolling-progress-bar">
                  <div
                    className="rolling-progress-fill"
                    style={{ width: `${(step.counted / step.total) * 100}%` }}
                  />
                </div>
                <div className="rolling-progress-label">
                  已开 {step.counted} / {step.total} 选区 · {Math.round(step.counted / step.total * 100)}%
                </div>
              </div>

              <div className="robust-summary-row">
                <div className="robust-stat">
                  <div className="robust-stat-label">当前领先</div>
                  <div className="robust-stat-val" style={{ fontSize: 14 }}>
                    <span style={{ color: partyColors[step.leader_party_id] || '#fff' }}>●</span>{' '}
                    {data.party_names[step.leader_party_id]}
                  </div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">领先党席位</div>
                  <div className="robust-stat-val">{step.leader_seats}</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">过半门槛</div>
                  <div className="robust-stat-val">{data.quota}</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">过半可能</div>
                  <div className="robust-stat-val" style={{ color: step.majority_reachable ? 'var(--accent-green)' : 'var(--accent-orange)', fontSize: 13 }}>
                    {step.majority_reachable ? '仍可达' : '已无望'}
                  </div>
                </div>
              </div>

              <div ref={chartRef} style={{ width: '100%', height: 260, marginTop: 10 }} />

              <div className="attack-section-title" style={{ marginTop: 12 }}>当前席位明细</div>
              <table className="analysis-table">
                <thead>
                  <tr><th>政党</th><th>席位</th><th>得票率</th></tr>
                </thead>
                <tbody>
                  {Object.keys(data.party_names).sort((a, b) => (step.party_seats[b] || 0) - (step.party_seats[a] || 0)).map(pid => (
                    <tr key={pid} className={pid === step.leader_party_id ? 'gov-row' : ''}>
                      <td>
                        <span className="coal-dot" style={{ background: partyColors[pid] || '#888' }} /> {data.party_names[pid]}
                        {pid === step.leader_party_id && <span style={{ fontSize: 10, color: 'var(--accent-green)', marginLeft: 4 }}>(领先)</span>}
                      </td>
                      <td style={{ fontWeight: 700 }}>{step.party_seats[pid] || 0}</td>
                      <td>{(step.party_votes[pid] || 0) * 100 > 0 ? ((step.party_votes[pid] || 0) * 100).toFixed(1) + '%' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                开票顺序按选区投票站进度随机生成；席位随各市计票结果实时累计。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}