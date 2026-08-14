import React, { useEffect, useMemo, useRef, useState } from 'react';

function buildPartial(fullResult, revealedProvinceNames, provByCity) {
  const revealedCities = (fullResult?.city_results || []).filter(cr => revealedProvinceNames.has(provByCity[cr.city_id]));

  const seats = {};
  const provinceMap = {};
  revealedCities.forEach(cr => {
    Object.entries(cr.party_seats || {}).forEach(([pid, n]) => {
      seats[pid] = (seats[pid] || 0) + n;
    });
    const prov = provByCity[cr.city_id] || '未知';
    if (!provinceMap[prov]) {
      provinceMap[prov] = { province_name: prov, party_seats: {}, seats: 0, num_cities: 0, vote_shares: {}, turnout_sum: 0 };
    }
    const p = provinceMap[prov];
    p.seats += cr.seats || 0;
    p.num_cities += 1;
    p.turnout_sum += cr.turnout || 0;
    Object.entries(cr.party_seats || {}).forEach(([pid, n]) => {
      p.party_seats[pid] = (p.party_seats[pid] || 0) + n;
    });
    Object.entries(cr.vote_shares || {}).forEach(([pid, s]) => {
      p.vote_shares[pid] = (p.vote_shares[pid] || 0) + s;
    });
  });

  const fullPartyResults = fullResult?.party_results || [];
  const party_results = fullPartyResults.map(p => ({ ...p, seats: seats[p.party_id] || 0 }));

  const province_results = Object.values(provinceMap).map(p => {
    const totalShares = Object.values(p.vote_shares).reduce((a, b) => a + b, 0) || 1;
    const vote_shares = {};
    Object.entries(p.vote_shares).forEach(([k, v]) => { vote_shares[k] = v / totalShares; });
    const sortedSeats = Object.entries(p.party_seats).sort((a, b) => b[1] - a[1]);
    const winnerId = sortedSeats[0]?.[0] || '';
    const winParty = fullPartyResults.find(pp => pp.party_id === winnerId);
    return {
      province_name: p.province_name,
      winner_party_id: winnerId,
      winner_party_name: winParty?.party_name || '',
      vote_shares,
      num_cities: p.num_cities,
      population: 0,
      seats: p.seats,
      avg_turnout: p.num_cities ? p.turnout_sum / p.num_cities : 0,
      party_seats: p.party_seats,
    };
  });

  return {
    ...fullResult,
    city_results: revealedCities,
    province_results,
    party_results,
  };
}

export default function CountReplay({ result, cities, totalSeats, onPartial, onFinish, onSkip }) {
  const provByCity = useMemo(() => {
    const m = {};
    (cities?.cities || []).forEach(c => { m[c.id] = c.province; });
    return m;
  }, [cities]);

  const order = useMemo(() => {
    const cityResults = result?.city_results || [];
    const provMap = {};
    cityResults.forEach(cr => {
      const prov = provByCity[cr.city_id] || '未知';
      (provMap[prov] = provMap[prov] || []).push(cr);
    });
    const marginOf = (list) => {
      const seats = {};
      list.forEach(cr => Object.entries(cr.party_seats || {}).forEach(([pid, n]) => {
        seats[pid] = (seats[pid] || 0) + n;
      }));
      const sorted = Object.entries(seats).sort((a, b) => b[1] - a[1]);
      if (sorted.length < 2) return 999;
      return sorted[0][1] - sorted[1][1];
    };
    return Object.entries(provMap)
      .map(([name, list]) => ({ name, cities: list, margin: marginOf(list) }))
      .sort((a, b) => b.margin - a.margin || a.cities.length - b.cities.length);
  }, [result, provByCity]);

  const totalCities = useMemo(() => (result?.city_results || []).length, [result]);
  const [revealedProvinceIdx, setRevealedProvinceIdx] = useState(0);
  const [ticker, setTicker] = useState('');
  const [speed, setSpeed] = useState(1);
  const [flipMsg, setFlipMsg] = useState('');
  const [complete, setComplete] = useState(false);
  const finishedRef = useRef(false);
  const leaderRef = useRef(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;
  const onPartialRef = useRef(onPartial);
  onPartialRef.current = onPartial;

  const revealedProvinceNames = useMemo(
    () => new Set(order.slice(0, revealedProvinceIdx).map(p => p.name)),
    [order, revealedProvinceIdx]
  );

  const partial = useMemo(
    () => buildPartial(result, revealedProvinceNames, provByCity),
    [result, revealedProvinceNames, provByCity]
  );

  const tally = useMemo(() => {
    const rows = (partial?.party_results || [])
      .map(p => ({ id: p.party_id, name: p.party_name, seats: p.seats || 0, color: p.color }))
      .filter(r => r.seats > 0)
      .sort((a, b) => b.seats - a.seats);
    const lead = rows[0]?.seats || 0;
    return rows.map(r => ({ ...r, pct: lead ? Math.max(6, (r.seats / lead) * 100) : 0 }));
  }, [partial]);

  const leader = tally[0];
  const majority = Math.floor((totalSeats || 450) / 2) + 1;
  const revealedCities = useMemo(
    () => order.slice(0, revealedProvinceIdx).reduce((s, p) => s + p.cities.length, 0),
    [order, revealedProvinceIdx]
  );

  useEffect(() => {
    if (!leader) return;
    if (leaderRef.current && leaderRef.current.id !== leader.id) {
      setFlipMsg(`${leader.name} 反超领先！`);
      const t = setTimeout(() => setFlipMsg(''), 2600);
      return () => clearTimeout(t);
    }
    leaderRef.current = leader;
  }, [leader?.id, leader?.name]);

  useEffect(() => {
    if (!order.length) return;
    if (revealedProvinceIdx >= order.length) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        setComplete(true);
        setTicker('');
        const t = setTimeout(() => onFinishRef.current(), 900);
        return () => clearTimeout(t);
      }
      return;
    }
    const prov = order[revealedProvinceIdx];
    let ci = 0;
    const tickerTimer = setInterval(() => {
      if (ci < prov.cities.length) {
        setTicker(`${prov.name} · ${prov.cities[ci].city_name}`);
        ci++;
      } else {
        clearInterval(tickerTimer);
      }
    }, 55);
    const t = setTimeout(() => setRevealedProvinceIdx(i => i + 1), 420 / speedRef.current);
    return () => { clearTimeout(t); clearInterval(tickerTimer); };
  }, [revealedProvinceIdx, order, speed]);

  useEffect(() => { onPartialRef.current?.(partial); }, [partial]);

  const skip = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onSkipRef.current?.();
  };

  const progressPct = totalCities ? Math.min(100, (revealedCities / totalCities) * 100) : 0;

  return (
    <div className="replay-panel">
      <div className="replay-head">
        <div>
          <div className="replay-title">{complete ? '开票完成' : '全国开票中'}</div>
          <div className="replay-sub">
            {complete ? '最终结果已出炉' : `已统计 ${revealedCities} / ${totalCities} 城市 · ${progressPct.toFixed(0)}%`}
          </div>
        </div>
        <div className="replay-controls">
          <button className={`replay-speed ${speed === 2 ? 'active' : ''}`} onClick={() => setSpeed(s => (s === 1 ? 2 : 1))}>×2</button>
          <button className="replay-skip" onClick={skip}>跳过 ▸</button>
        </div>
      </div>

      <div className="replay-progress"><div className="replay-progress-bar" style={{ width: `${progressPct}%` }} /></div>

      {!complete && ticker && <div className="replay-ticker">正在统计：{ticker}</div>}
      {complete && <div className="replay-ticker replay-done">✓ 全部 {totalCities} 城市已开票</div>}
      {flipMsg && <div className="replay-flip">⚡ {flipMsg}</div>}

      <div className="replay-tally">
        {tally.slice(0, 6).map((r, i) => (
          <div key={r.id} className={`replay-row ${i === 0 ? 'leading' : ''}`}>
            <span className="replay-rank">{i + 1}</span>
            <span className="replay-row-color" style={{ background: r.color }} />
            <span className="replay-row-name">{r.name}</span>
            <span className="replay-row-bar"><span style={{ width: `${r.pct}%`, background: r.color }} /></span>
            <span className="replay-row-seats">{r.seats}席</span>
          </div>
        ))}
      </div>

      <div className="replay-foot">
        {leader ? (
          <span>
            目前领先：<b style={{ color: leader.color }}>{leader.name}</b>（{leader.seats}席）· 过半需 {majority} 席
          </span>
        ) : (
          <span>开票中，请稍候…</span>
        )}
      </div>
    </div>
  );
}
