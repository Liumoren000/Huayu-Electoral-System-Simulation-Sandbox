import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { runGovernment } from '../services/api.js';

export default function GovernmentModal({ year, config, totalSeats, minSeats, parties, coalition, onClose }) {
  const chartRef = useRef(null);
  const pieRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [ruling, setRuling] = useState([]);

  const partyColors = useMemo(() => {
    const m = {};
    (parties || []).forEach(p => { m[p.id] = p.color; });
    return m;
  }, [parties]);

  const rulingOptions = useMemo(() => {
    const enabled = (parties || []).filter(p => p.enabled !== false);
    return enabled;
  }, [parties]);

  const run = async (rulingSel) => {
    setLoading(true);
    setError(null);
    try {
      const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
      const enabled = (parties || []).filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const d = await runGovernment({
        year,
        config: simConfig,
        parties: enabled,
        ruling_parties: rulingSel,
      });
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 与主界面"推荐联盟"对齐：默认采用 CoalitionEngine 推荐的执政联盟
    const recommended = coalition?.recommended_coalition?.parties || [];
    setRuling(recommended);
    run(recommended);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  useEffect(() => {
    if (!data || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          const p = params[0];
          let html = `第 ${p.axisValue} 个月<br/>`;
          params.forEach(pp => {
            if (pp.seriesName === '存活概率') html += `${pp.marker}存活概率: <b>${(pp.value * 100).toFixed(1)}%</b><br/>`;
            else if (pp.seriesName === '月度倒阁风险') html += `${pp.marker}月度倒阁风险: <b>${(pp.value * 100).toFixed(2)}%</b><br/>`;
            else if (pp.seriesName === '民众支持率') html += `${pp.marker}民众支持率: <b>${pp.value.toFixed(0)}</b><br/>`;
          });
          return html;
        },
      },
      legend: { textStyle: { color: '#ccc', fontSize: 10 }, top: 0 },
      grid: { left: 44, right: 16, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: data.survival_curve.map(s => s.month),
        name: '任期月',
        axisLabel: { color: '#aaa', fontSize: 10 },
        axisLine: { lineStyle: { color: '#444' } },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          min: 0,
          max: 1,
          axisLabel: { formatter: v => (v * 100).toFixed(0) + '%', color: '#aaa', fontSize: 10 },
          axisLine: { lineStyle: { color: '#444' } },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          axisLabel: { color: '#888', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '存活概率',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: data.survival_curve.map(s => s.survival_prob),
          lineStyle: { width: 2, color: '#4caf50' },
          areaStyle: { color: 'rgba(76,175,80,0.15)' },
          itemStyle: { color: '#4caf50' },
        },
        {
          name: '月度倒阁风险',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: data.survival_curve.map(s => s.hazard),
          lineStyle: { width: 1.5, color: '#ff5252' },
          itemStyle: { color: '#ff5252' },
        },
        {
          name: '民众支持率',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: data.survival_curve.map(s => s.approvals),
          lineStyle: { width: 1.5, color: '#ffb74d', type: 'dashed' },
          itemStyle: { color: '#ffb74d' },
        },
      ],
    });
    return () => chart.dispose();
  }, [data]);

  useEffect(() => {
    if (!data || !pieRef.current) return;
    const chart = echarts.init(pieRef.current);
    const colors = {
      '联盟内讧': '#ff8a65',
      '政策失败': '#ffd54f',
      '丑闻冲击': '#ba68c8',
      '经济冲击': '#4fc3f7',
    };
    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: p => `${p.marker}${p.name}: <b>${(p.value * 100).toFixed(1)}%</b>`,
      },
      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: '#ccc', fontSize: 10 } },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['35%', '50%'],
          data: Object.entries(data.reason_breakdown || {}).map(([k, v]) => ({
            name: k,
            value: v,
            itemStyle: { color: colors[k] || '#888' },
          })),
          label: { show: false },
        },
      ],
    });
    return () => chart.dispose();
  }, [data]);

  const toggleParty = (pid) => {
    const next = ruling.includes(pid) ? ruling.filter(x => x !== pid) : [...ruling, pid];
    setRuling(next);
    run(next);
  };

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>政府任期 · 寿命模拟</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="province-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>模拟政府任期…</div>}
          {error && <div style={{ color: '#ff5252', padding: 20 }}>{error}</div>}
          {!loading && !error && data && (
            <>
              <div className="attack-section-title">执政联盟（点击政党增减成员，空选=自动推荐）</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {rulingOptions.map(p => {
                  const active = data.ruling_parties.includes(p.id);
                  const manual = ruling.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleParty(p.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 12,
                        border: `1px solid ${active ? p.color : '#444'}`,
                        background: active ? (manual ? p.color : p.color + '33') : 'transparent',
                        color: active ? '#111' : '#ccc',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <div className="metric-card">
                  <div className="metric-label">执政党</div>
                  <div className="metric-value" style={{ fontSize: 13 }}>
                    {data.ruling_party_names.join(' + ') || '—'}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">预期存活</div>
                  <div className="metric-value" style={{ color: data.expected_months > data.term_months * 0.8 ? 'var(--accent-green)' : data.expected_months > data.term_months * 0.5 ? '#ffb74d' : '#ff5252' }}>
                    {data.expected_months} / {data.term_months} 月
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">走完全程概率</div>
                  <div className="metric-value" style={{ color: data.survival_prob_full_term > 0.6 ? 'var(--accent-green)' : data.survival_prob_full_term > 0.3 ? '#ffb74d' : '#ff5252' }}>
                    {(data.survival_prob_full_term * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">政策通过率</div>
                  <div className="metric-value" style={{ color: data.policy_pass_rate > 0.7 ? 'var(--accent-green)' : '#ffb74d' }}>
                    {(data.policy_pass_rate * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">预期通过法案</div>
                  <div className="metric-value">{data.expected_passed_bills} / {data.total_bills}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">信任投票</div>
                  <div className="metric-value">{(data.confidence_vote * 100).toFixed(0)}%</div>
                </div>
              </div>

              <div ref={chartRef} style={{ width: '100%', height: 300 }} />

              <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div className="attack-section-title">倒阁风险原因分解</div>
                  <div ref={pieRef} style={{ width: '100%', height: 180 }} />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    任期内倒阁累计概率 {(data.no_confidence_risk * 100).toFixed(1)}% · 联盟稳定度 {(data.base_stability * 100).toFixed(0)}% · 冗余席 +{data.seat_margin}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div className="attack-section-title">任期事件时间线</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', maxHeight: 190, overflowY: 'auto' }}>
                    {(data.events || []).map((e, i) => {
                      const color = e.type === 'no_confidence' ? '#ff5252' : e.type === 'policy_pass' ? '#4caf50' : e.type === 'policy_fail' ? '#ffb74d' : '#81c784';
                      return (
                        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', width: 70 }}>{e.month_label}</span>
                          <span style={{ color }}>●</span>
                          <div>
                            <b>{e.title}</b>
                            <div style={{ color: 'var(--text-muted)' }}>{e.description}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10 }}>
                模型：逐月状态机。存活概率受联盟内在稳定度（意识形态距离/政策兼容/成员数）、冗余席位、政策通过压力与随机冲击（丑闻/经济）共同决定；预期存活月数 = Σ逐月存活概率。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}