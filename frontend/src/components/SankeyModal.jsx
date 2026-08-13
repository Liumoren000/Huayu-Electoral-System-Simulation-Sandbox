import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { buildSankey } from '../utils/analysis.js';

export default function SankeyModal({ result, onClose }) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const { nodes, links } = buildSankey(result);

    chart.setOption({
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        formatter: p => {
          if (p.dataType === 'edge') {
            return `<b>${p.data.source.name}</b> → <b>${p.data.target.name}</b><br/>${p.data.value} 席`;
          }
          return p.data.name;
        },
      },
      series: [{
        type: 'sankey',
        data: nodes,
        links,
        nodeWidth: 14,
        nodeGap: 10,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        label: {
          color: '#c9d1d9',
          fontSize: 10,
          formatter: p => `${p.name} ${p.value || ''}`,
        },
        lineStyle: { color: 'gradient', opacity: 0.45 },
      }],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [result]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>省域席位流向（政党 → 省）</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div ref={chartRef} style={{ width: '100%', height: 460 }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.7 }}>
            左列 = 政党，右列 = 省份，流线宽度 = 该党在该省赢得的席位数。
            观察流线分布可判断政党是「全国铺开型」还是「区域深耕型」。
          </div>
        </div>
      </div>
    </div>
  );
}