import React, { useEffect, useState } from 'react';
import { explainCityVote } from '../services/api.js';

export default function ProvinceDetail({ province, result, cities, onClose, manualSeats, config, parties, year }) {
  const [explanation, setExplanation] = useState(null);
  const [expLoading, setExpLoading] = useState(false);
  const [expError, setExpError] = useState('');

  const cityNameMap = {};
  if (cities?.cities) {
    cities.cities.forEach(c => {
      cityNameMap[c.name] = c;
    });
  }
  const isCityView = !!cityNameMap[province];

  useEffect(() => {
    setExplanation(null);
    setExpError('');
    if (!isCityView || !parties?.length || !config) return;
    let cancelled = false;
    setExpLoading(true);
    (async () => {
      try {
        const cityId = cityNameMap[province]?.id;
        if (!cityId) return;
        const res = await explainCityVote({ year, config, parties, city_id: cityId });
        if (!cancelled) setExplanation(res);
      } catch (e) {
        if (!cancelled) setExpError(e.message);
      } finally {
        if (!cancelled) setExpLoading(false);
      }
    })();
    return () => { cancelled = true; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [province, isCityView]);

  if (!province || !result) return null;

  const cityProvinceMap = {};
  if (cities?.cities) {
    cities.cities.forEach(c => {
      cityProvinceMap[c.id] = c.province;
      cityNameMap[c.name] = c;
    });
  }

  let provinceCities;
  if (isCityView) {
    const cityId = cityNameMap[province]?.id;
    provinceCities = result.city_results.filter(cr => cr.city_id === cityId);
  } else {
    provinceCities = result.city_results.filter(cr => {
      return cityProvinceMap[cr.city_id] === province;
    });
  }

  const partyMap = {};
  result.party_results.forEach(p => { partyMap[p.party_id] = { ...p, name: p.name || p.party_name || p.party_id }; });

  const winnerParty = provinceCities[0] ? partyMap[provinceCities[0].winner_party_id] : null;
  const provResult = result.province_results.find(p => p.province_name === province);
  const totalSeats = result.total_seats;

  const manualProvinceSeats = manualSeats?.[province];
  const hasManualSeats = manualProvinceSeats && Object.values(manualProvinceSeats).some(v => v > 0);
  const manualTotal = hasManualSeats ? Object.values(manualProvinceSeats).reduce((s, v) => s + v, 0) : 0;

  if (provinceCities.length === 0 && !hasManualSeats) {
    return (
      <div className="province-detail">
        <div className="province-detail-header">
          <h2>{province}</h2>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="province-detail-body">
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>无数据</p>
        </div>
      </div>
    );
  }

  const provSeats = provResult?.seats || 0;
  const seatPct = totalSeats > 0 ? ((provSeats / totalSeats) * 100).toFixed(1) : 0;

  return (
    <div className="province-detail">
      <div className="province-detail-header">
        <div>
           <h2>{province}</h2>
          <div className="province-meta">
            {isCityView ? (
              <>地级市推演结果</>
            ) : (
              <>{provinceCities.length} 个城市 | 获胜: <span style={{ color: winnerParty?.color, fontWeight: 600, marginLeft: 4 }}>{provinceCities[0]?.winner_party_name || '-'}</span></>
            )}
          </div>
          {provSeats > 0 && (
            <div className="province-seats-badge">
              议会席位: <strong>{provSeats}席</strong> ({seatPct}% of {totalSeats})
            </div>
          )}
        </div>
        <button className="province-close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="province-detail-body">
        {isCityView && (
          <div className="city-explain-block">
            <div className="province-seats-title">为什么这座城市这样投票</div>
            {expLoading && <div style={{ fontSize: 12, color: 'var(--accent-blue)' }}>解读生成中...</div>}
            {expError && <div style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{expError}</div>}
            {explanation && !explanation.error && (
              <>
                <div className="city-explain-narrative">
                  {explanation.narrative.map((line, i) => (
                    <p key={i} style={{ margin: '4px 0', lineHeight: 1.6 }}>{line}</p>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
                  {explanation.structure.map(s => (
                    <span key={s.label} className="city-struct-chip">
                      {s.label}
                      {s.value ? <b> {s.value}</b> : null}
                      <span className="city-struct-note">{s.note}</span>
                    </span>
                  ))}
                </div>

                <div className="city-explain-dims">
                  {explanation.key_dims.map(k => (
                    <div key={k.dimension} className="city-explain-dim">
                      <span className="city-explain-dim-label">{k.label}</span>
                      <span className="city-explain-dim-pole">偏向「{k.pole}」</span>
                      <span className="city-explain-dim-dev">
                        {k.deviation > 0 ? '+' : ''}{k.deviation.toFixed(2)} vs 全国
                      </span>
                    </div>
                  ))}
                </div>

                <table className="province-city-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>政党</th>
                      <th style={{ textAlign: 'right' }}>得票</th>
                      <th style={{ textAlign: 'right' }}>亲和度</th>
                      <th>强势维度</th>
                      <th>弱势维度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {explanation.parties.map(p => (
                      <tr key={p.party_id} className={p.is_winner ? 'city-explain-winner' : ''}>
                        <td>
                          <span className="city-winner-dot" style={{ background: p.color }} />
                          {p.party_name}
                          {p.is_winner && <span style={{ fontSize: 10, color: 'var(--accent-green)', marginLeft: 6 }}>胜出</span>}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: p.is_winner ? 700 : 400 }}>
                          {(p.vote_share * 100).toFixed(1)}%
                        </td>
                        <td style={{ textAlign: 'right' }}>{p.affinity.toFixed(2)}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.best_dims.join('、')}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.worst_dims.join('、')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
        {hasManualSeats && (
          <div className="province-seats-section">
            <div className="province-seats-title">手动分配席位 ({manualTotal}席)</div>
            <div className="province-seats-grid">
              {Object.entries(manualProvinceSeats).map(([pid, seats]) => {
                if (seats <= 0) return null;
                const party = partyMap[pid];
                return (
                  <div key={pid} className="province-seat-chip">
                    <span className="city-winner-dot" style={{ background: party?.color || '#999' }} />
                    <span className="province-seat-party">{party?.name || pid}</span>
                    <span className="province-seat-count">{seats}席</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {provResult && !hasManualSeats && (
          <div className="province-seats-section">
            <div className="province-seats-title">各政党得票率</div>
            <div className="province-seats-grid">
              {Object.entries(provResult.vote_shares)
                .sort((a, b) => b[1] - a[1])
                .map(([pid, share]) => {
                  const party = partyMap[pid];
                  return (
                    <div key={pid} className="province-seat-chip">
                      <span className="city-winner-dot" style={{ background: party?.color || '#999' }} />
                      <span className="province-seat-party">{party?.name || pid}</span>
                      <span className="province-seat-count">{(share * 100).toFixed(1)}%</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {provinceCities.length > 0 && (
          <>
            <div className="province-seats-title" style={{ marginTop: 12 }}>{isCityView ? '推演结果' : '城市明细'}</div>
            <table className="province-city-table">
                <thead>
                  <tr>
                    <th>城市</th>
                    <th>获胜政党</th>
                    <th style={{ textAlign: 'center' }}>胜差</th>
                    <th style={{ textAlign: 'center' }}>投票率</th>
                    <th style={{ textAlign: 'center' }}>席位</th>
                    <th style={{ textAlign: 'center' }}>政治倾向</th>
                    <th style={{ textAlign: 'right' }}>得票分布</th>
                  </tr>
              </thead>
              <tbody>
                {provinceCities.map(cr => {
                  const sortedShares = Object.entries(cr.vote_shares).sort((a, b) => b[1] - a[1]);
                  const topParty = partyMap[sortedShares[0][0]];
                  const dims = cr.dimensions || {};
                  const affinities = cr.affinities || {};
                  const sortedAff = Object.entries(affinities).sort((a, b) => b[1] - a[1]);
                  const margin = (sortedShares[0]?.[1] ?? 0) - (sortedShares[1]?.[1] ?? 0);
                  return (
                     <tr key={cr.city_id}>
                       <td>{cr.city_name}</td>
                      <td>
                        <span className="city-winner-dot" style={{ background: topParty?.color || '#999' }} />
                        {cr.winner_party_name}
                      </td>
                      <td style={{
                        textAlign: 'center', fontWeight: 600,
                        color: margin > 0.10 ? 'var(--accent-green)' : margin < 0.03 ? 'var(--accent-orange)' : 'var(--text-secondary)',
                      }}>
                        {(margin * 100).toFixed(1)}%
                      </td>
                      <td style={{ textAlign: 'center', color: (cr.turnout || 0.6) > 0.7 ? 'var(--accent-green)' : (cr.turnout || 0.6) < 0.55 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
                        {((cr.turnout || 0.6) * 100).toFixed(0)}%
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent-blue)' }}>{cr.seats}</td>
                      <td>
                        <div className="city-leaning">
                          <div className="leaning-dims-grid">
                            {[
                              { key: 'economic', label: '经', color: '#4fc3d7' },
                              { key: 'social', label: '社', color: '#ff8a65' },
                              { key: 'regional', label: '区', color: '#81c784' },
                              { key: 'welfare', label: '福', color: '#ab47bc' },
                              { key: 'environment', label: '环', color: '#0d904f' },
                              { key: 'nationalism', label: '民', color: '#f57c00' },
                              { key: 'urban_rural', label: '城', color: '#1a73e8' },
                            ].map(({ key, label, color }) => (
                              <div key={key} className="dim-mini">
                                <span className="dim-mini-label">{label}</span>
                                <div className="dim-mini-bg">
                                  <div className="dim-mini-center" />
                                  <div className="dim-mini-bar" style={{
                                    width: `${Math.abs(dims[key] || 0) * 50}%`,
                                    background: color,
                                    left: dims[key] >= 0 ? '50%' : `${50 - Math.abs(dims[key] || 0) * 50}%`,
                                  }} />
                                </div>
                                <span className="dim-mini-val" style={{ color: dims[key] >= 0 ? color : '#ff8a65' }}>
                                  {(dims[key] || 0) >= 0 ? '+' : ''}{(dims[key] || 0).toFixed(1)}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="leaning-affinities">
                            {sortedAff.slice(0, 3).map(([pid, aff]) => {
                              const party = partyMap[pid];
                              return (
                                <div key={pid} className="aff-bar-row">
                                  <span className="aff-party" style={{ color: party?.color || '#999' }}>●</span>
                                  <div className="aff-bar-bg">
                                    <div className="aff-bar" style={{ width: `${(aff || 0) * 100}%`, background: party?.color || '#999' }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="city-shares">
                          {sortedShares.slice(0, 3).map(([pid, share]) => {
                            const party = partyMap[pid];
                            return (
                              <div key={pid} className="city-share-row">
                                <span className="city-share-party">
                                  <span className="city-winner-dot" style={{ background: party?.color || '#999', width: 5, height: 5 }} />
                                  {party?.name || pid}
                                </span>
                                <span className="city-share-pct">{(share * 100).toFixed(1)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
