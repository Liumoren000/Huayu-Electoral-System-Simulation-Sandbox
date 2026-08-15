import React, { useEffect, useMemo, useState } from 'react';
import { runSwingAnalysis } from '../services/api.js';

const LEVEL_LABEL = { tossup: '胶着', lean: '偏倾', safe: '稳固' };
const LEVEL_COLOR = { tossup: '#ff9800', lean: '#ffc107', safe: '#4caf50' };

export default function SwingAnalysisModal({ year, config, totalSeats, minSeats, parties, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [onlyBellwether, setOnlyBellwether] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
        const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
        const d = await runSwingAnalysis({ year, config: simConfig, parties: enabled });
        setData(d);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const partyMap = useMemo(() => {
    const m = {};
    (parties || []).forEach(p => { m[p.id] = p; });
    return m;
  }, [parties]);

  const rows = useMemo(() => {
    if (!data) return [];
    return (data.districts || []).filter(d => {
      if (onlyBellwether && !d.bellwether) return false;
      if (filter !== 'all' && d.swing_level !== filter) return false;
      return true;
    });
  }, [data, filter, onlyBellwether]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>选区级摇摆 · 风向标</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>分析各选区竞争度…</div>}
          {error && <div style={{ color: '#ff5252', padding: 20 }}>{error}</div>}
          {!loading && !error && data && (
            <>
              <div className="robust-summary-row">
                <div className="robust-stat">
                  <div className="robust-stat-label">全国最大党</div>
                  <div className="robust-stat-val" style={{ fontSize: 13 }}>
                    <span style={{ color: partyMap[data.national_leader]?.color || '#fff' }}>●</span> {data.national_leader_name}
                  </div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">胶着选区</div>
                  <div className="robust-stat-val" style={{ color: LEVEL_COLOR.tossup }}>{data.tossup_count}</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">偏倾选区</div>
                  <div className="robust-stat-val" style={{ color: LEVEL_COLOR.lean }}>{data.lean_count}</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">稳固选区</div>
                  <div className="robust-stat-val" style={{ color: LEVEL_COLOR.safe }}>{data.safe_count}</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">风向标选区</div>
                  <div className="robust-stat-val" style={{ color: '#ce93d8' }}>{data.bellwether_count}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 8px', flexWrap: 'wrap' }}>
                <select className="year-select" value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 11 }}>
                  <option value="all">全部</option>
                  <option value="tossup">胶着</option>
                  <option value="lean">偏倾</option>
                  <option value="safe">稳固</option>
                </select>
                <label className="check-label" style={{ marginBottom: 0 }}>
                  <input type="checkbox" checked={onlyBellwether} onChange={e => setOnlyBellwether(e.target.checked)} />
                  <span style={{ color: '#ce93d8' }}>仅看风向标</span>
                </label>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  共 {rows.length} 个选区
                </span>
              </div>

              <table className="analysis-table">
                <thead>
                  <tr>
                    <th>城市</th>
                    <th>胜者</th>
                    <th>追赶者</th>
                    <th>胜差</th>
                    <th>竞争度</th>
                    <th>风向标</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map(d => (
                    <tr key={d.city_id}>
                      <td style={{ fontWeight: 600 }}>{d.city_name}</td>
                      <td>
                        <span style={{ color: partyMap[d.winner_party_id]?.color || '#999' }}>● {d.winner_party_name}</span>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{d.runnerup_party_name}</td>
                      <td style={{ fontWeight: 700 }}>{(d.margin * 100).toFixed(1)}%</td>
                      <td>
                        <span style={{ color: LEVEL_COLOR[d.swing_level], fontWeight: 600 }}>
                          {LEVEL_LABEL[d.swing_level]}
                        </span>
                      </td>
                      <td>
                        {d.bellwether
                          ? <span style={{ color: '#ce93d8', fontWeight: 700 }}>◎ 风向标</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                竞争度按全市胜差分位数划分（前25% 胶着 / 25-60% 偏倾 / 其余稳固）。
                风向标 = 与全国最大党一致、胜差处于中等竞争带且接近全国平均的选区，历史上常预示全国走向。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}