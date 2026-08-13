import React, { useMemo, useState } from 'react';
import { computeTippingSeats } from '../utils/analysis.js';
import { findCoalitions } from '../utils/coalition.js';

const POSITION_DIMS = [
  'economic_position', 'social_position', 'regional_position',
  'welfare_position', 'environment_position',
  'nationalism_position', 'urban_rural_position',
];

const BILL_DIMS = [
  { key: 'economic_position', label: '经济', left: '国家干预', right: '市场自由' },
  { key: 'social_position', label: '社会', left: '传统价值', right: '自由进步' },
  { key: 'regional_position', label: '区域', left: '全国统一', right: '地方自治' },
  { key: 'welfare_position', label: '福利', left: '削减福利', right: '扩大福利' },
  { key: 'environment_position', label: '环保', left: '增长优先', right: '环保优先' },
  { key: 'nationalism_position', label: '民族', left: '国际开放', right: '国家保护' },
  { key: 'urban_rural_position', label: '城乡', left: '偏向城市', right: '偏向乡村' },
];

function supportProb(partyPos, billPos) {
  const dist = Math.abs(partyPos - billPos);
  return 1 / (1 + Math.exp(12 * (dist - 0.25)));
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const res = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) res.push([arr[i], ...p]);
  }
  return res;
}

function banzhafPower(members, quota) {
  if (!members.length) return [];
  return members.map((m, i) => {
    const others = members.filter((_, j) => j !== i);
    const perms = permutations(others);
    let piv = 0;
    for (const perm of perms) {
      let sum = 0;
      let isPiv = sum < quota && sum + m.seats >= quota;
      for (let k = 0; k < perm.length && !isPiv; k++) {
        sum += perm[k].seats;
        if (sum < quota && sum + m.seats >= quota) isPiv = true;
      }
      if (isPiv) piv++;
    }
    const power = perms.length ? piv / perms.length : (m.seats >= quota ? 1 : 0);
    return { ...m, power };
  });
}

function allocatePortfolios(members, totalPorts) {
  if (!members.length) return {};
  const totalSeats = members.reduce((s, m) => s + m.seats, 0);
  if (totalSeats <= 0) return {};
  const exact = members.map(m => m.seats * totalPorts / totalSeats);
  const floors = exact.map(Math.floor);
  let remaining = totalPorts - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (let k = 0; k < remaining; k++) floors[order[k % order.length].i] += 1;
  return members.reduce((o, m, i) => { o[m.id] = floors[i]; return o; }, {});
}

function govPosition(members, partyMap) {
  const total = members.reduce((s, m) => s + m.seats, 0) || 1;
  return POSITION_DIMS.map(d => members.reduce((s, m) => s + (partyMap[m.id]?.[d] ?? 0) * m.seats, 0) / total);
}

function ideologicalDistance(partyMap, members) {
  if (members.length < 2) return 0;
  const positions = members.map(m => POSITION_DIMS.map(d => partyMap[m.id]?.[d] ?? 0));
  let total = 0, count = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      let sq = 0;
      for (let d = 0; d < POSITION_DIMS.length; d++) sq += (positions[i][d] - positions[j][d]) ** 2;
      total += Math.sqrt(sq);
      count++;
    }
  }
  return count ? total / count : 0;
}

function policyCompatibility(partyMap, members) {
  if (members.length < 2) return 1;
  const scores = [];
  for (const dim of POSITION_DIMS) {
    const values = members.map(m => partyMap[m.id]?.[dim] ?? 0);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - avg) * (v - avg), 0) / values.length;
    scores.push(1.0 - Math.sqrt(variance) / 2.0);
  }
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

function stabilityScore(members, idDist, compat) {
  const idScore = Math.max(0, 1.0 - idDist / 3.0);
  const sizePenalty = Math.max(0, 1.0 - (members.length - 2) * 0.15);
  return Math.max(0, Math.min(1, idScore * 0.4 + compat * 0.4 + sizePenalty * 0.2));
}

export default function AttackDefenseModal({ result, parties, onClose, initialMode }) {
  const [mode, setMode] = useState(initialMode === 'legislation' ? 'legislation' : 'coalition');
  const [coalitionIds, setCoalitionIds] = useState(() => {
    const rec = result?.coalition;
    if (rec?.recommended_coalition?.parties?.length) return rec.recommended_coalition.parties;
    if (rec?.has_majority && rec.majority_party) return [rec.majority_party];
    const rows = (result?.party_results || []).slice().sort((a, b) => b.seats - a.seats);
    return rows.length ? [rows[0].party_id] : [];
  });
  const [upperCoalitionIds, setUpperCoalitionIds] = useState(() => {
    if (!result?.upper_house_total_seats) return [];
    const rec = findCoalitions(
      { party_results: result.upper_house_party_results || [], total_seats: result.upper_house_total_seats },
      parties || []
    );
    if (rec?.recommended_coalition?.parties?.length) return rec.recommended_coalition.parties;
    if (rec?.majority_party) return [rec.majority_party];
    return [];
  });
  const [whip, setWhip] = useState(0.9);
  const [dimIdx, setDimIdx] = useState(3);
  const [billPos, setBillPos] = useState(0.6);
  const [billOutcome, setBillOutcome] = useState(null);

  const partyMap = useMemo(() => {
    const m = {};
    (parties || []).forEach(p => { m[p.id] = p; });
    (result?.party_results || []).forEach(p => { if (!m[p.party_id]) m[p.party_id] = { id: p.party_id, name: p.party_name, color: p.color }; });
    return m;
  }, [parties, result]);

  const lowerRows = useMemo(
    () => (result?.party_results || []).slice().sort((a, b) => b.seats - a.seats),
    [result]
  );
  const hasUpper = (result?.upper_house_total_seats || 0) > 0;
  const upperRows = useMemo(
    () => (result?.upper_house_party_results || []).slice().sort((a, b) => b.seats - a.seats),
    [result]
  );
  const lowerTotal = result?.total_seats || 0;
  const lowerQuota = Math.floor(lowerTotal / 2) + 1;
  const upperTotal = hasUpper ? result.upper_house_total_seats : 0;
  const upperQuota = hasUpper ? Math.floor(upperTotal / 2) + 1 : 0;

  const lowerCoal = useMemo(() => lowerRows.filter(r => coalitionIds.includes(r.party_id)), [lowerRows, coalitionIds]);
  const upperCoal = useMemo(() => upperRows.filter(r => upperCoalitionIds.includes(r.party_id)), [upperRows, upperCoalitionIds]);

  const lowerStats = useMemo(() => {
    const coalTotal = lowerCoal.reduce((s, r) => s + r.seats, 0);
    const hasMaj = coalTotal >= lowerQuota;
    const excess = coalTotal - Math.floor(lowerTotal / 2) - 1;
    const minimal = hasMaj && lowerCoal.every(m => coalTotal - m.seats <= Math.floor(lowerTotal / 2));
    const members = lowerCoal.map(r => ({ id: r.party_id, seats: r.seats }));
    const power = banzhafPower(members, lowerQuota);
    const portfolios = allocatePortfolios(members, 20);
    const idDist = ideologicalDistance(partyMap, members);
    const compat = policyCompatibility(partyMap, members);
    const stability = stabilityScore(members, idDist, compat);
    return { coalTotal, hasMaj, excess, minimal, power, portfolios, idDist, compat, stability, govPos: govPosition(members, partyMap) };
  }, [lowerCoal, lowerTotal, lowerQuota, partyMap]);

  const upperStats = useMemo(() => {
    const coalTotal = upperCoal.reduce((s, r) => s + r.seats, 0);
    const hasMaj = coalTotal >= upperQuota;
    const minimal = hasMaj && upperCoal.every(m => coalTotal - m.seats <= Math.floor(upperTotal / 2));
    const members = upperCoal.map(r => ({ id: r.party_id, seats: r.seats }));
    const power = banzhafPower(members, upperQuota);
    const idDist = ideologicalDistance(partyMap, members);
    const compat = policyCompatibility(partyMap, members);
    const stability = stabilityScore(members, idDist, compat);
    return { coalTotal, hasMaj, minimal, power, idDist, compat, stability };
  }, [upperCoal, upperTotal, upperQuota, partyMap]);

  const analysis = useMemo(() => {
    if (!result?.city_results?.length) return null;
    const seats = {};
    (result.party_results || []).forEach(p => { seats[p.party_id] = p.seats; });
    const sorted = [...(result.party_results || [])].sort((a, b) => b.seats - a.seats);
    const largest = sorted[0];
    const hasMajority = largest && largest.seats > Math.floor(lowerTotal / 2);

    const tipping = computeTippingSeats(result, partyMap);
    const flips = tipping.filter(t => t.seats >= 1 && t.winner_party_id !== t.runnerup_party_id);

    const partyMax = (s) => {
      let id = null, n = -1;
      for (const [pid, v] of Object.entries(s)) if (v > n) { n = v; id = pid; }
      return { id, n };
    };

    const defense = flips.map(t => {
      const ns = { ...seats, [t.winner_party_id]: seats[t.winner_party_id] - 1, [t.runnerup_party_id]: (seats[t.runnerup_party_id] || 0) + 1 };
      const top = partyMax(ns);
      const newMajId = top.n > Math.floor(lowerTotal / 2) ? top.id : null;
      let effect;
      if (hasMajority && newMajId !== largest.party_id) effect = 'break_majority';
      else if (top.id !== largest.party_id) effect = 'flip_largest';
      else effect = 'stable';
      return { ...t, effect };
    });

    const attackMap = {};
    flips.forEach(t => {
      if (!attackMap[t.runnerup_party_id]) {
        attackMap[t.runnerup_party_id] = {
          party_id: t.runnerup_party_id,
          name: t.runnerup_party_name,
          color: partyMap[t.runnerup_party_id]?.color,
          now: seats[t.runnerup_party_id] || 0,
          flippable: [],
        };
      }
      attackMap[t.runnerup_party_id].flippable.push(t);
    });
    const attack = [];
    for (const [pid, a] of Object.entries(attackMap)) {
      a.flippable.sort((x, y) => x.margin - y.margin);
      const ns = { ...seats };
      a.flippable.forEach(f => { ns[f.winner_party_id] -= 1; ns[f.runnerup_party_id] += 1; });
      const top = partyMax(ns);
      const maj = Math.floor(lowerTotal / 2);
      let need = maj - (seats[pid] || 0) + 1;
      let flipsToMajority = need >= 1 && a.flippable.length >= need ? need : null;
      const maxOther = Math.max(...Object.keys(ns).filter(k => k !== pid).map(k => ns[k]), 0);
      let needL = maxOther - (seats[pid] || 0) + 1;
      let flipsToLargest = needL >= 1 && a.flippable.length >= needL ? needL : null;
      attack.push({ ...a, becomesLargest: top.id === pid, becomesMajority: ns[pid] > maj, totalAfter: ns[pid], flipsToMajority, flipsToLargest });
    }
    attack.sort((a, b) => b.flippable.length - a.flippable.length);
    const crowning = attack.find(a => a.becomesMajority);
    return { largest, hasMajority, defense, attack, crowning };
  }, [result, lowerTotal, partyMap]);

  const toggleId = (setter, id) => setter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const runBill = () => {
    const trials = 300;
    const dim = BILL_DIMS[dimIdx];
    let lowerPass = 0, upperPass = 0, jointPass = 0;
    for (let t = 0; t < trials; t++) {
      let ls = 0;
      for (const p of lowerRows) {
        const party = partyMap[p.party_id];
        const base = supportProb(party ? (party[dim.key] ?? 0) : 0, billPos);
        const pYes = coalitionIds.includes(p.party_id) ? (whip + (1 - whip) * base) : base;
        if (Math.random() < pYes) ls += p.seats;
      }
      const lp = ls > Math.floor(lowerTotal / 2);
      if (lp) lowerPass++;
      if (hasUpper) {
        let us = 0;
        for (const p of upperRows) {
          const party = partyMap[p.party_id];
          const base = supportProb(party ? (party[dim.key] ?? 0) : 0, billPos);
          const pYes = upperCoalitionIds.includes(p.party_id) ? (whip + (1 - whip) * base) : base;
          if (Math.random() < pYes) us += p.seats;
        }
        const up = us > Math.floor(upperTotal / 2);
        if (up) upperPass++;
        if (lp && up) jointPass++;
      }
    }
    const lowerProb = lowerRows.map(p => {
      const party = partyMap[p.party_id];
      const base = supportProb(party ? (party[dim.key] ?? 0) : 0, billPos);
      const inGov = coalitionIds.includes(p.party_id);
      const pYes = inGov ? (whip + (1 - whip) * base) : base;
      return { ...p, prob: Math.round(pYes * 100), gov: inGov };
    });
    const expectedLower = lowerRows.reduce((s, p) => {
      const party = partyMap[p.party_id];
      const base = supportProb(party ? (party[dim.key] ?? 0) : 0, billPos);
      const pYes = coalitionIds.includes(p.party_id) ? (whip + (1 - whip) * base) : base;
      return s + p.seats * pYes;
    }, 0);
    const upperResult = hasUpper ? {
      parties: upperRows.map(p => {
        const party = partyMap[p.party_id];
        const base = supportProb(party ? (party[dim.key] ?? 0) : 0, billPos);
        const inGov = upperCoalitionIds.includes(p.party_id);
        const pYes = inGov ? (whip + (1 - whip) * base) : base;
        return { ...p, prob: Math.round(pYes * 100), gov: inGov };
      }),
      expected: upperRows.reduce((s, p) => {
        const party = partyMap[p.party_id];
        const base = supportProb(party ? (party[dim.key] ?? 0) : 0, billPos);
        const pYes = upperCoalitionIds.includes(p.party_id) ? (whip + (1 - whip) * base) : base;
        return s + p.seats * pYes;
      }, 0),
    } : null;
    setBillOutcome({
      lowerProb, expectedLower, upperResult,
      lowerRate: lowerPass / trials,
      upperRate: hasUpper ? upperPass / trials : 1,
      jointRate: hasUpper ? jointPass / trials : lowerPass / trials,
      trials,
    });
  };

  if (!result) return null;
  const dim = BILL_DIMS[dimIdx];

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal attack-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>组阁推演 · 立法联动</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className={`mode-btn ${mode === 'coalition' ? 'active' : ''}`}
              onClick={() => setMode('coalition')}
            >联盟搭建</button>
            <button
              className={`mode-btn ${mode === 'legislation' ? 'active' : ''}`}
              onClick={() => setMode('legislation')}
            >立法推演</button>
            <button className="province-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {mode === 'coalition' ? (
          <div className="analysis-body">
            <div className="robust-summary-row">
              <div className="robust-stat">
                <div className="robust-stat-label">执政联盟席位</div>
                <div className="robust-stat-val" style={{ color: lowerStats.hasMaj ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                  {lowerStats.coalTotal} / {lowerQuota}
                </div>
              </div>
              <div className="robust-stat">
                <div className="robust-stat-label">执政状态</div>
                <div className="robust-stat-val" style={{ fontSize: 13 }}>
                  {lowerStats.hasMaj ? (lowerStats.minimal ? '最小获胜联盟' : '多数执政') : '少数派政府'}
                </div>
              </div>
              <div className="robust-stat">
                <div className="robust-stat-label">稳定度</div>
                <div className="robust-stat-val" style={{ color: lowerStats.stability > 0.6 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                  {(lowerStats.stability * 100).toFixed(0)}%
                </div>
              </div>
              {hasUpper && (
                <div className="robust-stat">
                  <div className="robust-stat-label">上院多数</div>
                  <div className="robust-stat-val" style={{ color: upperStats.hasMaj ? 'var(--accent-green)' : 'var(--accent-orange)', fontSize: 13 }}>
                    {upperStats.hasMaj ? `${upperStats.coalTotal}/${upperQuota}` : '未过半'}
                  </div>
                </div>
              )}
            </div>

            <div className="attack-section-title">执政联盟 · 下议院（{lowerTotal}席，过半需 {lowerQuota}席）</div>
            <div className="coal-grid">
              {lowerRows.map(r => {
                const inGov = coalitionIds.includes(r.party_id);
                return (
                  <button
                    key={r.party_id}
                    className={`coal-chip ${inGov ? 'selected' : ''}`}
                    onClick={() => toggleId(setCoalitionIds, r.party_id)}
                    title={r.party_name}
                  >
                    <span className="coal-dot" style={{ background: r.color || '#888' }} />
                    <span className="coal-name">{r.party_name}</span>
                    <span className="coal-seats">{r.seats}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 6, margin: '8px 0 12px', flexWrap: 'wrap' }}>
              <button className="copy-btn" onClick={() => {
                const rec = result?.coalition;
                if (rec?.recommended_coalition?.parties) setCoalitionIds(rec.recommended_coalition.parties);
                else if (rec?.has_majority && rec.majority_party) setCoalitionIds([rec.majority_party]);
              }}>推荐联盟</button>
              <button className="copy-btn" onClick={() => setCoalitionIds([])}>清空</button>
              <button className="copy-btn" onClick={() => setCoalitionIds([lowerRows[0]?.party_id].filter(Boolean))}>仅第一大党</button>
            </div>

            {lowerStats.coalTotal >= lowerQuota && (
              <>
                <div className="attack-section-title">联盟概况 · 权力与部委分配（20 个部委，最大余数法）</div>
                <table className="analysis-table">
                  <thead>
                    <tr><th>成员党</th><th>席位</th><th>Banzhaf 权力指数</th><th>部委</th></tr>
                  </thead>
                  <tbody>
                    {lowerCoal.map(m => (
                      <tr key={m.party_id}>
                        <td><span className="coal-dot" style={{ background: m.color || '#888', display: 'inline-block' }} /> {m.party_name}</td>
                        <td>{m.seats}</td>
                        <td>{(lowerStats.power.find(x => x.id === m.party_id)?.power || 0).toFixed(2)}</td>
                        <td>{lowerStats.portfolios[m.party_id] ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  冗余 {lowerStats.excess} 席 · 意识形态距离 {(lowerStats.idDist).toFixed(2)} · 政策兼容度 {(lowerStats.compat * 100).toFixed(0)}%
                  {lowerStats.minimal && <span style={{ color: 'var(--accent-green)' }}> · 任意一党退出即失去多数</span>}
                </div>
              </>
            )}

            {hasUpper && (
              <>
                <div className="attack-section-title" style={{ marginTop: 12 }}>上议院多数联盟（{upperTotal}席，过半需 {upperQuota}席）</div>
                <div className="coal-grid">
                  {upperRows.map(r => {
                    const inGov = upperCoalitionIds.includes(r.party_id);
                    return (
                      <button
                        key={r.party_id}
                        className={`coal-chip ${inGov ? 'selected' : ''}`}
                        onClick={() => toggleId(setUpperCoalitionIds, r.party_id)}
                        title={r.party_name}
                      >
                        <span className="coal-dot" style={{ background: r.color || '#888' }} />
                        <span className="coal-name">{r.party_name}</span>
                        <span className="coal-seats">{r.seats}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 6, margin: '8px 0 4px' }}>
                  <button className="copy-btn" onClick={() => {
                    const rec = findCoalitions({ party_results: upperRows, total_seats: upperTotal }, parties || []);
                    if (rec?.recommended_coalition?.parties) setUpperCoalitionIds(rec.recommended_coalition.parties);
                    else if (rec?.majority_party) setUpperCoalitionIds([rec.majority_party]);
                  }}>推荐上院联盟</button>
                  <button className="copy-btn" onClick={() => {
                    const govWithUpper = lowerCoal.map(m => m.party_id).filter(pid => upperRows.some(u => u.party_id === pid));
                    setUpperCoalitionIds(govWithUpper);
                  }}>沿用执政党（有上院席位）</button>
                  <button className="copy-btn" onClick={() => setUpperCoalitionIds([])}>清空</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {upperStats.hasMaj ? `上院联盟 ${upperStats.coalTotal} 席${upperStats.minimal ? '（最小获胜）' : ''} · 稳定度 ${(upperStats.stability * 100).toFixed(0)}%` : '上院未过半，立法将依赖反对党或跨党支持'}
                </div>
              </>
            )}

            <div className="attack-section-title" style={{ marginTop: 12 }}>政府政策立场（各党席位加权）</div>
            <div className="gov-pos-row">
              {POSITION_DIMS.map((d, i) => (
                <div className="gov-pos-item" key={d}>
                  <span className="gov-pos-label">{BILL_DIMS[i].label}</span>
                  <div className="gov-pos-bar">
                    <div className="gov-pos-track">
                      <div className="gov-pos-mid" />
                      <div className="gov-pos-marker" style={{ left: `${((lowerStats.govPos[i] ?? 0) + 1) / 2 * 100}%` }} />
                    </div>
                  </div>
                  <span className="gov-pos-val">{((lowerStats.govPos[i] ?? 0) >= 0 ? '+' : '')}{(lowerStats.govPos[i] ?? 0).toFixed(1)}</span>
                </div>
              ))}
            </div>

            {analysis && (
              <>
                <div className="attack-section-title" style={{ marginTop: 12 }}>攻防临界 · 高危险翻转席</div>
                <table className="analysis-table">
                  <thead>
                    <tr><th>#</th><th>城市</th><th>胜者</th><th>追赶者</th><th>胜差</th><th>失守影响</th></tr>
                  </thead>
                  <tbody>
                    {analysis.defense.slice(0, 10).map((d, i) => (
                      <tr key={d.city_id}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{d.city_name}</td>
                        <td><span style={{ color: partyMap[d.winner_party_id]?.color || '#999' }}>● {d.winner_party_name}</span></td>
                        <td><span style={{ color: partyMap[d.runnerup_party_id]?.color || '#999' }}>{d.runnerup_party_name}</span></td>
                        <td style={{ fontWeight: 700, color: d.margin < 0.03 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>{(d.margin * 100).toFixed(1)}%</td>
                        <td>
                          {d.effect === 'break_majority' && <span style={{ color: '#ff5252', fontWeight: 700 }}>☠ 多数告破</span>}
                          {d.effect === 'flip_largest' && <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>⚡ 易主</span>}
                          {d.effect === 'stable' && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  追赶党夺权窗口：{analysis.attack.filter(a => a.becomesMajority || a.becomesLargest).length
                    ? analysis.attack.filter(a => a.becomesMajority || a.becomesLargest).slice(0, 3).map(a =>
                      `${a.name}（${a.becomesMajority ? '过半需' + a.flipsToMajority + '席' : '第一大党需' + a.flipsToLargest + '席'}）`).join('、')
                    : '无单党可通过选区翻转夺权'}
                  {['PR', 'MMP', 'PARALLEL'].includes(result.system_type) && <span style={{ color: 'var(--accent-orange)' }}> · 注：比例制下翻转近似推演</span>}
                </div>
              </>
            )}

            <button className="run-btn" style={{ marginTop: 14 }} onClick={() => setMode('legislation')}>
              基于该联盟进行立法推演 ⚖
            </button>
          </div>
        ) : (
          <div className="analysis-body">
            <div className="leg-coal-summary">
              <span style={{ fontWeight: 700 }}>执政联盟：</span>
              {lowerCoal.length ? lowerCoal.map(m => (
                <span key={m.party_id} className="leg-coal-chip">
                  <span className="coal-dot" style={{ background: m.color || '#888' }} />{m.party_name} {m.seats}
                </span>
              )) : <span style={{ color: 'var(--accent-orange)' }}>未组建（自由投票）</span>}
              <span style={{ color: lowerStats.hasMaj ? 'var(--accent-green)' : 'var(--accent-orange)', fontWeight: 700 }}>
                · {lowerStats.hasMaj ? `多数（${lowerStats.coalTotal}/${lowerQuota}）` : `少数派（${lowerStats.coalTotal}/${lowerQuota}）`}
              </span>
            </div>

            <div className="form-row" style={{ marginBottom: 8, marginTop: 10 }}>
              <label>政策维度</label>
              <select value={dimIdx} onChange={e => { setDimIdx(parseInt(e.target.value)); setBillOutcome(null); }}>
                {BILL_DIMS.map((d, i) => (
                  <option key={d.key} value={i}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="slider-row" style={{ marginBottom: 4 }}>
              <label>
                <span>法案立场</span>
                <span>{billPos >= 0 ? '+' : ''}{billPos.toFixed(1)}</span>
              </label>
              <input type="range" min="-1" max="1" step="0.05" value={billPos}
                onChange={e => { setBillPos(parseFloat(e.target.value)); setBillOutcome(null); }} />
            </div>
            <div className="slider-row" style={{ marginBottom: 4 }}>
              <label>
                <span>执政党纪律</span>
                <span>{Math.round(whip * 100)}%</span>
              </label>
              <input type="range" min="0.5" max="1" step="0.05" value={whip}
                onChange={e => { setWhip(parseFloat(e.target.value)); setBillOutcome(null); }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>
              <span>{dim.left} ← — → {dim.right}</span>
              <span>执政党按纪律投票（可反水），反对党自由投票</span>
            </div>
            <button className="run-btn" onClick={runBill} disabled={!!billOutcome}>开始推演</button>

            {billOutcome && (
              <div style={{ marginTop: 14 }}>
                <div className="robust-summary-row">
                  <div className="robust-stat">
                    <div className="robust-stat-label">下议院通过率</div>
                    <div className="robust-stat-val">{Math.round(billOutcome.lowerRate * 100)}%</div>
                  </div>
                  {hasUpper && (
                    <div className="robust-stat">
                      <div className="robust-stat-label">上议院通过率</div>
                      <div className="robust-stat-val">{Math.round(billOutcome.upperRate * 100)}%</div>
                    </div>
                  )}
                  <div className="robust-stat">
                    <div className="robust-stat-label">两院共同通过</div>
                    <div className="robust-stat-val" style={{ color: billOutcome.jointRate > 0.5 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                      {Math.round(billOutcome.jointRate * 100)}%
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '10px 0 4px' }}>
                  下议院（{lowerTotal}席，过半需 {lowerQuota}席）· 执政党 = 绿底
                </div>
                <table className="analysis-table">
                  <thead>
                    <tr><th>政党</th><th>席位</th><th>支持概率</th><th>支持仓位</th><th></th></tr>
                  </thead>
                  <tbody>
                    {billOutcome.lowerProb.map(p => (
                      <tr key={p.party_id} className={p.gov ? 'gov-row' : ''}>
                        <td><span className="coal-dot" style={{ background: p.color || '#888' }} /> {p.party_name}{p.gov && <span style={{ fontSize: 10, color: 'var(--accent-green)', marginLeft: 4 }}>(执政)</span>}</td>
                        <td>{p.seats}</td>
                        <td style={{ color: p.prob >= 60 ? 'var(--accent-green)' : p.prob <= 40 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>{p.prob}%</td>
                        <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>{Math.round(p.seats * p.prob / 100)}席</td>
                        <td>{p.gov ? '🗳' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0' }}>
                  期望支持席位 ≈ {Math.round(billOutcome.expectedLower)} / {lowerQuota}
                </div>

                {hasUpper && (
                  <>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '10px 0 4px' }}>
                      上议院（{upperTotal}席，过半需 {upperQuota}席）
                    </div>
                    <table className="analysis-table">
                      <thead>
                        <tr><th>政党</th><th>席位</th><th>支持概率</th><th>支持仓位</th><th></th></tr>
                      </thead>
                      <tbody>
                        {billOutcome.upperResult.parties.map(p => (
                          <tr key={p.party_id} className={p.gov ? 'gov-row' : ''}>
                            <td><span className="coal-dot" style={{ background: p.color || '#888' }} /> {p.party_name}{p.gov && <span style={{ fontSize: 10, color: 'var(--accent-green)', marginLeft: 4 }}>(执政)</span>}</td>
                            <td>{p.seats}</td>
                            <td style={{ color: p.prob >= 60 ? 'var(--accent-green)' : p.prob <= 40 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>{p.prob}%</td>
                            <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>{Math.round(p.seats * p.prob / 100)}席</td>
                            <td>{p.gov ? '🗳' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 4px' }}>
                  {hasUpper
                    ? `法案需两院均过半方可生效（${billOutcome.trials} 次蒙特卡洛）`
                    : `单院制：一院过半即生效（${billOutcome.trials} 次蒙特卡洛）`}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}