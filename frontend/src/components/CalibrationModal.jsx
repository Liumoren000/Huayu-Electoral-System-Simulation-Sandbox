import React, { useEffect, useMemo, useState } from 'react';
import { runCalibration } from '../services/api.js';

export default function CalibrationModal({ config, totalSeats, minSeats, parties, year, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
        const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
        const d = await runCalibration({ config: simConfig, parties: enabled, year });
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

  const cityRows = useMemo(() => {
    if (!data) return [];
    if (filter === 'flipped') return data.cities.filter(c => c.flipped);
    if (filter === 'held') return data.cities.filter(c => !c.flipped);
    return data.cities;
  }, [data, filter]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>历史选举校准 {data ? `${data.baseline_year} → ${data.current_year}` : ''}</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>运行历史对照…</div>}
          {error && <div style={{ color: '#ff5252', padding: 20 }}>{error}</div>}
          {!loading && !error && data && (
            <>
              <div className="robust-summary-row">
                <div className="robust-stat">
                  <div className="robust-stat-label">第一大党</div>
                  <div className="robust-stat-val" style={{ fontSize: 13 }}>
                    {data.national_leader_prev_name}
                    <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>→</span>
                    <span style={{ color: partyMap[data.national_leader_cur]?.color || '#fff' }}>●</span> {data.national_leader_cur_name}
                  </div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">执政党易主</div>
                  <div className="robust-stat-val" style={{ color: data.gov_changed ? '#ff5252' : 'var(--accent-green)', fontSize: 13 }}>
                    {data.gov_changed ? '是 ⚡' : '否'}
                  </div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">城市翻盘</div>
                  <div className="robust-stat-val" style={{ color: 'var(--accent-orange)' }}>
                    {data.flipped_cities} / {data.total_cities}
                  </div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">稳定度</div>
                  <div className="robust-stat-val" style={{ color: data.stability_index > 0.7 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                    {(data.stability_index * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">席位波动</div>
                  <div className="robust-stat-val">{(data.seat_volatility * 100).toFixed(0)}%</div>
                </div>
              </div>

              <div className="attack-section-title" style={{ marginTop: 10 }}>席位与得票变化</div>
              <table className="analysis-table">
                <thead>
                  <tr>
                    <th>政党</th>
                    <th>{data.baseline_year} 席</th>
                    <th>{data.current_year} 席</th>
                    <th>席位变化</th>
                    <th>得票变化</th>
                  </tr>
                </thead>
                <tbody>
                  {data.parties.map(p => (
                    <tr key={p.party_id}>
                      <td>
                        <span className="coal-dot" style={{ background: p.color || '#888' }} /> {p.party_name}
                      </td>
                      <td>{p.prev_seats}</td>
                      <td style={{ fontWeight: 700 }}>{p.cur_seats}</td>
                      <td style={{ color: p.delta > 0 ? 'var(--accent-green)' : p.delta < 0 ? '#ff5252' : 'var(--text-muted)', fontWeight: 700 }}>
                        {p.delta > 0 ? `+${p.delta}` : p.delta}
                      </td>
                      <td style={{ color: p.vote_delta > 0 ? 'var(--accent-green)' : p.vote_delta < 0 ? '#ff5252' : 'var(--text-muted)' }}>
                        {p.vote_delta > 0 ? '+' : ''}{(p.vote_delta * 100).toFixed(1)}ppt
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 8px', flexWrap: 'wrap' }}>
                <select className="year-select" value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 11 }}>
                  <option value="all">全部城市</option>
                  <option value="flipped">仅看翻盘</option>
                  <option value="held">仅看连任</option>
                </select>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>共 {cityRows.length} 个城市</span>
              </div>
              <table className="analysis-table">
                <thead>
                  <tr><th>城市</th><th>{data.baseline_year} 胜者</th><th>{data.current_year} 胜者</th><th>状态</th><th>本届胜差</th></tr>
                </thead>
                <tbody>
                  {cityRows.slice(0, 60).map(c => (
                    <tr key={c.city_id}>
                      <td style={{ fontWeight: 600 }}>{c.city_name}</td>
                      <td style={{ color: partyMap[c.prev_winner]?.color || '#888' }}>{partyMap[c.prev_winner]?.name || c.prev_winner || '-'}</td>
                      <td style={{ color: partyMap[c.cur_winner]?.color || '#888' }}>
                        <span style={{ color: partyMap[c.cur_winner]?.color || '#888' }}>●</span> {partyMap[c.cur_winner]?.name || c.cur_winner}
                      </td>
                      <td>
                        {c.flipped
                          ? <span style={{ color: '#ff5252', fontWeight: 700 }}>⚡ 翻盘</span>
                          : <span style={{ color: 'var(--accent-green)' }}>连任</span>}
                      </td>
                      <td>{(c.margin * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                基准年（{data.baseline_year}）城市数据经研究年代库（era）与本届同口径加载，配以不同随机种子，对比本届（{data.current_year}）以衡量模型稳定性与人口结构漂移效应。
              </div>

              {data.flow_matrix?.length > 0 && (
                <>
                  <div className="attack-section-title" style={{ marginTop: 14 }}>选区赢家转移（{data.baseline_year} → {data.current_year}）</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {data.flow_matrix.slice(0, 18).map((f, i) => (
                      <span key={i} className="poll-event-chip" style={{ borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' }}>
                        <span style={{ color: partyMap[f.prev_party_id]?.color || '#888' }}>{f.prev_party_name}</span>
                        <span style={{ margin: '0 3px' }}>→</span>
                        <span style={{ color: partyMap[f.cur_party_id]?.color || '#888' }}>{f.cur_party_name}</span>
                        <b> {f.count}城</b>
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    上届由某党赢下的城市，本届改投他党——展示选区层面"选票转移"的主流方向与规模。
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}