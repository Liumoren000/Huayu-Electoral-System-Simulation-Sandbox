import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { runPoll } from '../services/api.js';

export default function PollModal({ config, totalSeats, minSeats, parties, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [weeks, setWeeks] = useState(12);

  const run = async (w) => {
    setLoading(true);
    setError(null);
    try {
      const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
      const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const d = await runPoll({ config: simConfig, parties: enabled, weeks: w });
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(weeks); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const partyColors = useMemo(() => {
    const m = {};
    (parties || []).forEach(p => { m[p.id] = p.color; });
    return m;
  }, [parties]);

  useEffect(() => {
    if (!data || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const weeksCount = data.weeks;
    const partyIds = Object.keys(data.final_share || {});
    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          let html = `第 ${params[0]?.value?.[0] ?? params[0]?.axisValue} 周<br/>`;
          params.forEach(p => { html += `${p.marker}${p.seriesName}: <b>${(p.value[1] * 100).toFixed(1)}%</b><br/>`; });
          return html;
        },
      },
      legend: { textStyle: { color: '#ccc', fontSize: 10 }, top: 0 },
      grid: { left: 40, right: 16, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: weeksCount }, (_, i) => i + 1),
        name: '周',
        axisLabel: { color: '#aaa', fontSize: 10 },
        axisLine: { lineStyle: { color: '#444' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: v => (v * 100).toFixed(0) + '%', color: '#aaa', fontSize: 10 },
        axisLine: { lineStyle: { color: '#444' } },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      series: partyIds.map(pid => {
        const points = data.series.filter(s => s.party_id === pid).map(s => [s.week, s.share]);
        return {
          name: parties.find(p => p.id === pid)?.name || pid,
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: points,
          lineStyle: { width: 2, color: partyColors[pid] || '#888' },
          itemStyle: { color: partyColors[pid] || '#888' },
        };
      }),
    });
    return () => chart.dispose();
  }, [data, partyColors, parties]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>竞选民调 · 舆论推演</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              className="year-select"
              value={weeks}
              onChange={e => { setWeeks(parseInt(e.target.value)); run(parseInt(e.target.value)); }}
              style={{ fontSize: 11 }}
            >
              {[8, 12, 16, 20].map(w => <option key={w} value={w}>{w} 周</option>)}
            </select>
            <button className="province-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>生成民调曲线…</div>}
          {error && <div style={{ color: '#ff5252', padding: 20 }}>{error}</div>}
          {!loading && !error && data && (
            <>
              <div ref={chartRef} style={{ width: '100%', height: 300 }} />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
                {data.note} 民调曲线自第 1 周起向确定性基准结果收敛，末周值贴近实际得票率。
              </div>

              {data.events?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div className="attack-section-title">舆论事件冲击</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {data.events.map((e, i) => (
                      <span
                        key={i}
                        className="poll-event-chip"
                        style={{ borderColor: e.direction > 0 ? '#4caf50' : '#ff5252', color: e.direction > 0 ? '#81c784' : '#ff8a80' }}
                      >
                        第{e.week}周 · {e.label} {e.direction > 0 ? '▲' : '▼'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="attack-section-title">选前预测（席位投影 + 蒙特卡洛 {200} 次）</div>
              <table className="analysis-table">
                <thead>
                  <tr>
                    <th>政党</th>
                    <th>最终民调</th>
                    <th>席位预测</th>
                    <th>最大党概率</th>
                    <th>过半概率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecasts.map(f => (
                    <tr key={f.party_id}>
                      <td>
                        <span className="coal-dot" style={{ background: f.color || '#888' }} /> {f.party_name}
                      </td>
                      <td>{(f.poll_share * 100).toFixed(1)}%</td>
                      <td style={{ fontWeight: 700 }}>{f.seat_projection} 席</td>
                      <td style={{ color: f.win_prob > 0.5 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                        {(f.win_prob * 100).toFixed(0)}%
                      </td>
                      <td style={{ color: f.majority_prob > 0.5 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                        {(f.majority_prob * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                席位预测 = 确定性基准席位；最大党/过半概率 = 当前制度下 200 次不同随机种子模拟的频率。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}