import React, { useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { computeCompositeIndex } from '../utils/analysis.js';

export default function RadarModal({ resultA, resultB, onClose }) {
  const chartRef = useRef(null);
  const active = resultB ? resultB : resultA;
  const idxA = useMemo(() => computeCompositeIndex(resultA), [resultA]);
  const idxB = useMemo(() => computeCompositeIndex(resultB), [resultB]);
  const activeIdx = resultB ? idxB : idxA;

  useEffect(() => {
    if (!chartRef.current || !activeIdx) return;
    const chart = echarts.init(chartRef.current);
    const dims = Object.keys(activeIdx.indices);
    const series = [];
    if (idxA) {
      series.push({
        name: (resultA?.system_type || '方案A') + ' (方案A)',
        type: 'radar',
        data: [{ value: Object.values(idxA.indices), name: '方案A' }],
        areaStyle: { color: 'rgba(79, 195, 247, 0.25)' },
        lineStyle: { color: '#4fc3f7', width: 2 },
        itemStyle: { color: '#4fc3f7' },
      });
    }
    if (idxB) {
      series.push({
        name: (resultB?.system_type || '方案B') + ' (方案B)',
        type: 'radar',
        data: [{ value: Object.values(idxB.indices), name: '方案B' }],
        areaStyle: { color: 'rgba(255, 112, 67, 0.25)' },
        lineStyle: { color: '#ff7043', width: 2 },
        itemStyle: { color: '#ff7043' },
      });
    }

    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: p => {
          const i = p.dataIndex;
          let h = `<b>${p.seriesName}</b><br/>`;
          dims.forEach((d, k) => {
            h += `${d}: ${p.data.value[k].toFixed(0)}<br/>`;
          });
          return h;
        },
      },
      legend: {
        data: series.map(s => s.name),
        textStyle: { color: '#c9d1d9', fontSize: 11 },
        top: 4,
      },
      radar: {
        indicator: dims.map(d => ({ name: d, max: 100 })),
        radius: '60%',
        center: ['50%', '58%'],
        axisName: { color: '#8b949e', fontSize: 11 },
        splitLine: { lineStyle: { color: '#21262d' } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0.01)', 'rgba(255,255,255,0.02)'] } },
        axisLine: { lineStyle: { color: '#30363d' } },
      },
      series,
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [idxA, idxB, activeIdx, resultA, resultB]);

  if (!activeIdx) {
    return (
      <div className="analysis-overlay" onClick={onClose}>
        <div className="analysis-modal" onClick={e => e.stopPropagation()}>
          <div className="analysis-header"><h3>综合代表指数</h3><button className="province-close-btn" onClick={onClose}>✕</button></div>
          <div className="analysis-body"><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>暂无数据。</div></div>
        </div>
      </div>
    );
  }

  const dims = Object.keys(activeIdx.indices);
  const compareArr = [idxA, idxB].filter(Boolean);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>综合代表指数</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div ref={chartRef} style={{ width: '100%', height: 330 }} />
          <div className="robust-summary-row" style={{ marginTop: 12 }}>
            {idxA && (
              <div className="robust-stat">
                <div className="robust-stat-label">{resultA?.system_type || '方案A'} 综合指数</div>
                <div className="robust-stat-val" style={{ color: 'var(--accent-blue)' }}>{idxA.composite.toFixed(0)}</div>
              </div>
            )}
            {idxB && (
              <div className="robust-stat">
                <div className="robust-stat-label">{resultB.system_type} 综合指数</div>
                <div className="robust-stat-val" style={{ color: 'var(--accent-orange)' }}>{idxB.composite.toFixed(0)}</div>
              </div>
            )}
            <div className="robust-stat">
              <div className="robust-stat-label">六维均值（0-100）</div>
              <div className="robust-stat-val">{compareArr.reduce((s, x) => s + x.composite, 0) / Math.max(1, compareArr.length)}</div>
            </div>
          </div>
          <table className="analysis-table" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>维度</th>{idxA && <th>{resultA?.system_type || '方案A'}</th>}{idxB && <th>{resultB.system_type}</th>}</tr>
            </thead>
            <tbody>
              {dims.map(d => (
                <tr key={d}>
                  <td>{d}</td>
                  {idxA && <td>{idxA.indices[d].toFixed(0)}</td>}
                  {idxB && <td>{idxB.indices[d].toFixed(0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}