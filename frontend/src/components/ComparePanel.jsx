import React, { useMemo } from 'react';

function summarize(r) {
  if (!r) return null;
  const pr = r.party_results || [];
  const largest = pr.reduce((m, p) => (p.seats > m.seats ? p : m), pr[0] || null);
  return {
    totalSeats: r.total_seats,
    effSeats: r.effective_parties_seats ?? 0,
    effVote: r.effective_parties_vote ?? 0,
    gallagher: r.gallagher_index ?? 0,
    largest: largest ? { name: largest.party_name, seats: largest.seats } : null,
    majority: pr.find(p => p.seats > (r.total_seats || 1) / 2)?.party_name || null,
  };
}

function StatCard({ label, accent, data }) {
  if (!data) return <div className="compare-card"><div className="compare-card-label">{label}</div><div className="compare-empty">无数据</div></div>;
  return (
    <div className="compare-card">
      <div className="compare-card-label" style={{ color: accent }}>{label}</div>
      <div className="compare-card-row"><span>有效政党数(席)</span><b>{(data.effSeats).toFixed(2)}</b></div>
      <div className="compare-card-row"><span>有效政党数(得票)</span><b>{(data.effVote).toFixed(2)}</b></div>
      <div className="compare-card-row"><span>Gallagher 指数</span><b>{(data.gallagher).toFixed(2)}</b></div>
      <div className="compare-card-row"><span>最大党</span><b>{data.largest ? `${data.largest.name} ${data.largest.seats}席` : '-'}</b></div>
      <div className="compare-card-row">
        <span>过半政党</span>
        <b style={{ color: data.majority ? 'var(--accent-green)' : 'var(--text-muted)' }}>
          {data.majority || '无'}
        </b>
      </div>
    </div>
  );
}

export default function ComparePanel({ resultA, resultB, onClose }) {
  const data = useMemo(() => {
    const a = summarize(resultA);
    const b = summarize(resultB);

    const cityByIdA = {};
    (resultA?.city_results || []).forEach(cr => { cityByIdA[cr.city_id] = cr; });
    const cityByIdB = {};
    (resultB?.city_results || []).forEach(cr => { cityByIdB[cr.city_id] = cr; });
    let sharedCities = 0, flipCities = 0;
    for (const id of Object.keys(cityByIdA)) {
      if (!cityByIdB[id]) continue;
      sharedCities++;
      if (cityByIdA[id].winner_party_id !== cityByIdB[id].winner_party_id) flipCities++;
    }

    const provByIdA = {};
    (resultA?.province_results || []).forEach(pr => { provByIdA[pr.province_name] = pr; });
    const provByIdB = {};
    (resultB?.province_results || []).forEach(pr => { provByIdB[pr.province_name] = pr; });
    let sharedProvinces = 0, flipProvinces = 0;
    for (const name of Object.keys(provByIdA)) {
      if (!provByIdB[name]) continue;
      sharedProvinces++;
      if (provByIdA[name].winner_party_id !== provByIdB[name].winner_party_id) flipProvinces++;
    }

    const partyMap = {};
    (resultA?.party_results || []).forEach(p => { partyMap[p.party_id] = p; });
    (resultB?.party_results || []).forEach(p => { if (!partyMap[p.party_id]) partyMap[p.party_id] = p; });
    const idSet = new Set([...(resultA?.party_results || []).map(p => p.party_id), ...(resultB?.party_results || []).map(p => p.party_id)]);
    const partyRows = [...idSet].map(id => {
      const pa = (resultA?.party_results || []).find(p => p.party_id === id);
      const pb = (resultB?.party_results || []).find(p => p.party_id === id);
      const aSeats = pa?.seats ?? 0;
      const bSeats = pb?.seats ?? 0;
      return {
        id,
        name: pa?.party_name || pb?.party_name || id,
        color: pa?.color || pb?.color || '#888',
        a: aSeats,
        b: bSeats,
        diff: bSeats - aSeats,
      };
    }).sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));

    return { a, b, flipCities, sharedCities, flipProvinces, sharedProvinces, partyRows };
  }, [resultA, resultB]);

  return (
    <div className="compare-overlay">
      <div className="compare-header">
        <span style={{ fontWeight: 700 }}>制度对比</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
          {data.flipCities}/{data.sharedCities} 城市 · {data.flipProvinces}/{data.sharedProvinces} 省份翻盘
        </span>
        <button className="province-close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="compare-stats">
        <StatCard label="方案A" accent="var(--accent-blue)" data={data.a} />
        <StatCard label="方案B" accent="var(--accent-orange)" data={data.b} />
      </div>

      <div className="compare-table-wrap">
        <table className="result-table compare-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>政党</th>
              <th>A席</th>
              <th>B席</th>
              <th>差值</th>
            </tr>
          </thead>
          <tbody>
            {data.partyRows.map(row => (
              <tr key={row.id}>
                <td style={{ textAlign: 'left' }}>
                  <span className="city-winner-dot" style={{ background: row.color }} />
                  {row.name}
                </td>
                <td>{row.a}</td>
                <td>{row.b}</td>
                <td style={{
                  color: row.diff > 0 ? 'var(--accent-green)' : row.diff < 0 ? 'var(--accent-orange)' : 'var(--text-muted)',
                  fontWeight: row.diff !== 0 ? 700 : 400,
                }}>
                  {row.diff > 0 ? `+${row.diff}` : row.diff}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
