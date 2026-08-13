import React, { useMemo } from 'react';
import { computeTippingSeats } from '../utils/analysis.js';

export default function TippingSeatsModal({ result, onClose }) {
  const partyMap = useMemo(() => {
    const m = {};
    (result?.party_results || []).forEach(p => { m[p.party_id] = p; });
    return m;
  }, [result]);

  const rows = useMemo(() => computeTippingSeats(result, partyMap), [result, partyMap]);
  const highRisk = rows.filter(r => r.margin < 0.05);
  const topN = rows.slice(0, 15);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>翻转临界席（惜败席）</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div className="robust-summary-row">
            <div className="robust-stat">
              <div className="robust-stat-label">分析选区</div>
              <div className="robust-stat-val">{rows.length}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">胜差 &lt;5% 高危区</div>
              <div className="robust-stat-val" style={{ color: 'var(--accent-orange)' }}>{highRisk.length}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">最小胜差</div>
              <div className="robust-stat-val">{rows.length ? (rows[0].margin * 100).toFixed(1) + '%' : '-'}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 6px' }}>
            按「第一名 − 第二名」得票差升序排列，差距越小越可能因小幅票仓波动翻盘。市级地图中高危选区（胜差 &lt;5%）已黄色高亮。
            注：在纯比例制下翻盘不直接改变该市席位分配（席位跟随选票比例），但仍是选民倾向易变的敏感选区。
          </div>
          <table className="analysis-table">
            <thead>
              <tr>
                <th>#</th>
                <th>城市</th>
                <th>当前胜者</th>
                <th>追赶者</th>
                <th>胜差</th>
                <th>翻盘尚需</th>
              </tr>
            </thead>
            <tbody>
              {topN.map((r, i) => (
                <tr key={r.city_id}>
                  <td>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{r.city_name}</td>
                  <td>
                    <span style={{ color: partyMap[r.winner_party_id]?.color || '#999' }}>● {r.winner_party_name}</span>
                  </td>
                  <td>
                    <span style={{ color: partyMap[r.runnerup_party_id]?.color || '#999' }}>{r.runnerup_party_name}</span>
                  </td>
                  <td style={{ color: r.margin < 0.05 ? 'var(--accent-orange)' : 'var(--text-secondary)', fontWeight: 700 }}>
                    {(r.margin * 100).toFixed(1)}%
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    净增 {(r.margin * 100).toFixed(1)}ppt
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}