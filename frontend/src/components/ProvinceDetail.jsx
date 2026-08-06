import React from 'react';

export default function ProvinceDetail({ province, result, cities, onClose, manualSeats }) {
  if (!province || !result) return null;

  const cityProvinceMap = {};
  const cityNameMap = {};
  if (cities?.cities) {
    cities.cities.forEach(c => {
      cityProvinceMap[c.id] = c.province;
      cityNameMap[c.name] = c;
    });
  }

  const isCityView = !!cityNameMap[province];

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
  result.party_results.forEach(p => { partyMap[p.party_id] = p; });

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
                  <th style={{ textAlign: 'center' }}>席位</th>
                  <th style={{ textAlign: 'right' }}>得票分布</th>
                </tr>
              </thead>
              <tbody>
                {provinceCities.map(cr => {
                  const sortedShares = Object.entries(cr.vote_shares).sort((a, b) => b[1] - a[1]);
                  const topParty = partyMap[sortedShares[0][0]];
                  return (
                    <tr key={cr.city_id}>
                      <td>{cr.city_name}</td>
                      <td>
                        <span className="city-winner-dot" style={{ background: topParty?.color || '#999' }} />
                        {cr.winner_party_name}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent-blue)' }}>{cr.seats}</td>
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
