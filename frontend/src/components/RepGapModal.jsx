import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { runRepresentationGap } from '../services/api.js';

const DIM_LABELS = { age: '年龄', education: '教育', urban_rural: '城乡', income: '收入' };

export default function RepGapModal({ config, parties, year, onClose }) {
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      setLoading(true);
      try {
        const res = await runRepresentationGap({ year, config, parties });
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
    const groups = data.groups.slice().sort((a, b) => b.distance_to_government - a.distance_to_government);
    chart.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const idx = ps[0].dataIndex;
          const g = groups[idx];
          return `<b>${g.group_label}</b>（${DIM_LABELS[g.dimension] || g.dimension_label}）<br/>` +
            `距执政党（${data.government_party_name}）: ${g.distance_to_government}<br/>` +
            `距中位选民: ${g.distance_to_median}<br/>立场: 经济 ${g.economic} · 社会 ${g.social}`;
        },
      },
      grid: { left: 140, right: 40, top: 24, bottom: 30 },
      xAxis: {
        type: 'value',
        name: '政策立场距离（曼哈顿距离）',
        nameTextStyle: { color: '#8b949e' },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: {
        type: 'category',
        data: groups.map(g => `${g.group_label}（${DIM_LABELS[g.dimension] || ''}）`),
        axisLabel: { color: '#8b949e', fontSize: 11 },
        axisLine: { lineStyle: { color: '#8b949e' } },
      },
      series: [
        {
          name: '距执政党',
          type: 'bar',
          data: groups.map(g => g.distance_to_government),
          itemStyle: { color: '#ff7043' },
        },
        {
          name: '距中位选民',
          type: 'bar',
          data: groups.map(g => g.distance_to_median),
          itemStyle: { color: '#4fc3f7' },
        },
      ],
    });
    return () => chart.dispose();
  }, [data]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>代表性缺口 · Representation Gap</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>计算中...</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{error}</div>}
          {data && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                执政党 <b style={{ color: data.government_color }}>{data.government_party_name}</b> 立场（经济
                {data.government_economic > 0 ? '+' : ''}{data.government_economic} · 社会
                {data.government_social > 0 ? '+' : ''}{data.government_social}），中位选民（经济
                {data.median_economic > 0 ? '+' : ''}{data.median_economic} · 社会
                {data.median_social > 0 ? '+' : ''}{data.median_social}）。距离越大 = 该群体立场越偏离执政者，
                代表性越弱。
              </div>
              <div ref={chartRef} style={{ width: '100%', height: 300 }} />
              {data.most_underrepresented && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}>
                  <b style={{ color: 'var(--accent-orange)' }}>最不被代表：{data.most_underrepresented.group_label}</b>
                  （{DIM_LABELS[data.most_underrepresented.dimension] || data.most_underrepresented.dimension_label}）
                  — 与执政党立场距离 {data.most_underrepresented.distance_to_government}，是所有人口群体中偏离最远的。
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}