import React, { useEffect, useMemo, useRef, useState } from 'react';

function divisorAllocation(pops, totalSeats, method) {
  const keys = Object.keys(pops);
  if (!keys.length || totalSeats <= 0) return {};
  const seats = {};
  for (const k of keys) seats[k] = 0;
  for (let s = 0; s < totalSeats; s++) {
    let best = null;
    let bestQ = -1;
    for (const k of keys) {
      const divisor = method === 'sainte_lague' ? (2 * seats[k] + 1) : (seats[k] + 1);
      const q = pops[k] / divisor;
      if (q > bestQ) { bestQ = q; best = k; }
    }
    if (best != null) seats[best]++;
  }
  return seats;
}

function largestRemainder(pops, totalSeats) {
  const keys = Object.keys(pops);
  const total = Object.values(pops).reduce((s, v) => s + v, 0) || 1;
  const seats = {};
  const remainders = {};
  for (const k of keys) {
    const quota = (pops[k] / total) * totalSeats;
    seats[k] = Math.floor(quota);
    remainders[k] = quota - Math.floor(quota);
  }
  let remaining = totalSeats - Object.values(seats).reduce((s, v) => s + v, 0);
  const sorted = keys.slice().sort((a, b) => remainders[b] - remainders[a]);
  for (let i = 0; i < remaining && i < sorted.length; i++) seats[sorted[i]]++;
  return seats;
}

function allocatePr(votes, totalSeats, threshold, method) {
  let eligible = { ...votes };
  if (threshold && Object.values(votes).reduce((s, v) => s + v, 0) > 0) {
    const total = Object.values(votes).reduce((s, v) => s + v, 0);
    const filtered = {};
    Object.entries(votes).forEach(([pid, v]) => { if (v / total >= threshold) filtered[pid] = v; });
    if (Object.keys(filtered).length > 0) eligible = filtered;
  }
  if (method === 'sainte_lague') return divisorAllocation(eligible, totalSeats, 'sainte_lague');
  if (method === 'largest_remainder') return largestRemainder(eligible, totalSeats);
  return divisorAllocation(eligible, totalSeats, 'd_hondt');
}

function buildPartial(fullResult, config, revealedProvinceNames, provByCity, citiesById) {
  const revealedCities = (fullResult?.city_results || []).filter(cr => revealedProvinceNames.has(provByCity[cr.city_id]));

  // 全国运行票数（每个已开票城市：人口 × 投票率 × 得票率）
  const votes = {};
  revealedCities.forEach(cr => {
    const city = citiesById[cr.city_id];
    const eligible = cr.eligible_voter_ratio ?? 0.79;
    const cityVotes = (city?.population || 0) * eligible * (cr.turnout || 0);
    Object.entries(cr.vote_shares || {}).forEach(([pid, s]) => {
      votes[pid] = (votes[pid] || 0) + cityVotes * s;
    });
  });

  // 全国席位投影：按方案真实分配逻辑重算，保证与最终结果一致
  const totalSeats = config?.total_seats || fullResult?.total_seats || 450;
  const method = config?.allocation_method || 'd_hondt';
  const threshold = config?.threshold ?? 0;
  const system = config?.system_type || fullResult?.system_type || 'PR';

  if (!Object.keys(votes).length) {
    return {
      ...fullResult,
      total_seats: totalSeats,
      city_results: revealedCities,
      province_results: (fullResult?.province_results || []).filter(pr => revealedProvinceNames.has(pr.province_name)),
      party_results: (fullResult?.party_results || []).map(p => ({ ...p, seats: 0 })),
    };
  }

  const districtSeats = {};
  revealedCities.forEach(cr => {
    Object.entries(cr.party_seats || {}).forEach(([pid, n]) => {
      districtSeats[pid] = (districtSeats[pid] || 0) + n;
    });
  });

  const districtTotal = Object.values(districtSeats).reduce((a, b) => a + b, 0);
  const listTotal = Math.max(0, totalSeats - districtTotal);

  let projected;
  if (system === 'PR') {
    projected = allocatePr(votes, totalSeats, threshold, method);
  } else if (system === 'MMP') {
    const ideal = allocatePr(votes, totalSeats, threshold, method);
    const list = {};
    Object.keys(ideal).forEach(pid => { list[pid] = Math.max(0, ideal[pid] - (districtSeats[pid] || 0)); });
    let s = Object.values(list).reduce((a, b) => a + b, 0);
    if (s < listTotal) {
      while (s < listTotal) {
        const pid = Object.keys(list).reduce((a, b) => {
          const va = (ideal[a] || 0) - (districtSeats[a] || 0) - (list[a] || 0);
          const vb = (ideal[b] || 0) - (districtSeats[b] || 0) - (list[b] || 0);
          return va >= vb ? a : b;
        });
        list[pid]++;
        s++;
      }
    } else if (s > listTotal) {
      while (s > listTotal) {
        const candidates = Object.keys(list).filter(p => list[p] > 0);
        if (!candidates.length) break;
        const pid = candidates.reduce((a, b) => {
          const va = (districtSeats[a] || 0) - (ideal[a] || 0);
          const vb = (districtSeats[b] || 0) - (ideal[b] || 0);
          return va >= vb ? a : b;
        });
        list[pid]--;
        s--;
      }
    }
    projected = {};
    Object.keys(votes).forEach(pid => { projected[pid] = (districtSeats[pid] || 0) + (list[pid] || 0); });
  } else if (system === 'PARALLEL') {
    const list = allocatePr(votes, listTotal, threshold, method);
    projected = {};
    Object.keys(votes).forEach(pid => { projected[pid] = (districtSeats[pid] || 0) + (list[pid] || 0); });
  } else {
    // FPTP / RUNOFF：胜者全得，逐市累加即全国结果
    projected = districtSeats;
  }

  const partyMap = {};
  (fullResult?.party_results || []).forEach(p => { partyMap[p.party_id] = p; });
  const party_results = Object.keys(votes).length
    ? Object.keys(partyMap).map(pid => ({
        ...partyMap[pid],
        seats: projected[pid] || 0,
      }))
    : (fullResult?.party_results || []).map(p => ({ ...p, seats: 0 }));

  // 地图：只点亮已开票省份的真实最终结果（未开票保持暗色）
  const province_results = (fullResult?.province_results || []).filter(pr => revealedProvinceNames.has(pr.province_name));
  const city_results = revealedCities;

  return {
    ...fullResult,
    total_seats: totalSeats,
    city_results,
    province_results,
    party_results,
  };
}

export default function CountReplay({ result, config, cities, totalSeats, onPartial, onFinish, onSkip }) {
  const provByCity = useMemo(() => {
    const m = {};
    (cities?.cities || []).forEach(c => { m[c.id] = c.province; });
    return m;
  }, [cities]);

  const citiesById = useMemo(() => {
    const m = {};
    (cities?.cities || []).forEach(c => { m[c.id] = c; });
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
      const votes = {};
      list.forEach(cr => {
        const city = citiesById[cr.city_id];
        const eligible = cr.eligible_voter_ratio ?? 0.79;
        const v = (city?.population || 0) * eligible * (cr.turnout || 0);
        Object.entries(cr.vote_shares || {}).forEach(([pid, s]) => { votes[pid] = (votes[pid] || 0) + v * s; });
      });
      const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      if (sorted.length < 2) return 999;
      return sorted[0][1] - sorted[1][1];
    };
    return Object.entries(provMap)
      .map(([name, list]) => ({ name, cities: list, margin: marginOf(list) }))
      .sort((a, b) => b.margin - a.margin || a.cities.length - b.cities.length);
  }, [result, provByCity, citiesById]);

  const totalCityCount = useMemo(() => (result?.city_results || []).length, [result]);
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

  const allRevealed = revealedProvinceNames.size >= order.length;
  const partial = useMemo(
    () => (allRevealed ? result : buildPartial(result, config, revealedProvinceNames, provByCity, citiesById)),
    [result, config, revealedProvinceNames, provByCity, citiesById, allRevealed]
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

  const progressPct = totalCityCount ? Math.min(100, (revealedCities / totalCityCount) * 100) : 0;

  return (
    <div className="replay-panel">
      <div className="replay-head">
        <div>
          <div className="replay-title">{complete ? '开票完成' : '全国开票中'}</div>
          <div className="replay-sub">
            {complete ? '最终结果已出炉' : `已统计 ${revealedCities} / ${totalCityCount} 城市 · ${progressPct.toFixed(0)}%`}
          </div>
        </div>
        <div className="replay-controls">
          <button className={`replay-speed ${speed === 2 ? 'active' : ''}`} onClick={() => setSpeed(s => (s === 1 ? 2 : 1))}>×2</button>
          <button className="replay-skip" onClick={skip}>跳过 ▸</button>
        </div>
      </div>

      <div className="replay-progress"><div className="replay-progress-bar" style={{ width: `${progressPct}%` }} /></div>

      {!complete && ticker && <div className="replay-ticker">正在统计：{ticker}</div>}
      {complete && <div className="replay-ticker replay-done">✓ 全部 {totalCityCount} 城市已开票</div>}
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
