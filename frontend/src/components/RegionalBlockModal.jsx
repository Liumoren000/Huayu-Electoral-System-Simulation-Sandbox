import React, { useMemo } from 'react';

export default function RegionalBlockModal({ result, onClose }) {
  const blocks = useMemo(() => (result?.regional_blocks || []).slice().sort((a, b) => b.total_seats - a.total_seats), [result]);

  const totalSeats = result?.total_seats || 1;
  const totalPop = (result?.province_results || []).reduce((s, p) => s + (p.population || 0), 0);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>区域政治版图</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {!blocks.length && <div style={{ color: 'var(--text-muted)', padding: 20 }}>暂无数据</div>}
          {blocks.map(b => (
            <div key={b.party_id} style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="coal-dot" style={{ background: b.color || '#888', width: 12, height: 12, borderRadius: 6 }} />
                <b style={{ fontSize: 14 }}>{b.party_name}</b>
                <span className="poll-event-chip" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>{b.block_label || '区域混合'}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {b.province_count} 省 · {b.total_seats} 席（占 {((b.total_seats / totalSeats) * 100).toFixed(1)}%）· 覆盖人口 {(b.total_population / 10000).toFixed(0)} 万人
                {totalPop > 0 ? `（占 ${((b.total_population / totalPop) * 100).toFixed(0)}%）` : ''}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                {b.provinces?.join('、')}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            按各省赢家归纳的选区集团——真实政治地理分析中，同一政党赢得的省份常构成稳定的选区集团（如沿海带、边疆西部带、跨区域带）。
          </div>
        </div>
      </div>
    </div>
  );
}