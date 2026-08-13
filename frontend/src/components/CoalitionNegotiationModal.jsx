import React, { useMemo, useState } from 'react';

const POSITION_DIMS = [
  'economic_position', 'social_position', 'regional_position',
  'welfare_position', 'environment_position',
  'nationalism_position', 'urban_rural_position',
];

function dist(a, b) {
  return Math.sqrt(POSITION_DIMS.reduce((s, d) => s + ((a?.[d] ?? 0) - (b?.[d] ?? 0)) ** 2, 0));
}

function compatibility(partyMap, ids) {
  if (ids.length < 2) return 1;
  const scores = [];
  for (const dim of POSITION_DIMS) {
    const values = ids.map(pid => partyMap[pid]?.[dim] ?? 0);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
    scores.push(1.0 - Math.sqrt(variance) / 2.0);
  }
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

// 谈判序列：formateur 依意识形态接近度依次发出组阁邀请，
// 被邀党按"兼容度 + 入阁回报"决定接受或拒绝。
function simulateNegotiation(partyMap, partyResults, totalSeats, quota, seed = 1) {
  const parties = partyResults.filter(p => p.seats > 0).slice().sort((a, b) => b.seats - a.seats);
  const steps = [];
  const winner = parties[0];
  const majority = winner.seats >= quota;

  if (majority) {
    return {
      formateur: winner.party_id,
      majority_single: true,
      steps: [{ type: 'single', party_id: winner.party_id, seats: winner.seats, quota }],
      coalition: [winner.party_id],
      seats: winner.seats,
      compatible: 1,
      success: true,
    };
  }

  let rng = seed;
  const rand = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };

  const coalition = [winner.party_id];
  let coalSeats = winner.seats;
  steps.push({ type: 'init', party_id: winner.party_id, party_name: winner.party_name, seats: winner.seats, quota, coalSeats });

  // 依与 formateur 的意识形态距离排序候选党
  const candidates = parties.filter(p => p.party_id !== winner.party_id).slice();
  const inviteOrder = candidates.slice().sort((a, b) => dist(partyMap[a.party_id], partyMap[winner.party_id]) - dist(partyMap[b.party_id], partyMap[winner.party_id]));

  for (const cand of inviteOrder) {
    if (coalSeats >= quota) break;
    const newIds = [...coalition, cand.party_id];
    const compat = compatibility(partyMap, newIds);
    // 接受概率：兼容度 * 席位权重（入阁回报）
    const acceptProb = Math.min(0.95, Math.max(0.05, compat * (0.6 + cand.seats / totalSeats)));
    const accepted = rand() < acceptProb;
    if (accepted) {
      coalition.push(cand.party_id);
      coalSeats += cand.seats;
      steps.push({
        type: 'accept',
        party_id: cand.party_id,
        party_name: cand.party_name,
        seats: cand.seats,
        accept_prob: acceptProb,
        compat,
        coalSeats,
        reached: coalSeats >= quota,
      });
    } else {
      steps.push({
        type: 'decline',
        party_id: cand.party_id,
        party_name: cand.party_name,
        seats: cand.seats,
        accept_prob: acceptProb,
        compat,
        coalSeats,
      });
    }
  }

  return {
    formateur: winner.party_id,
    majority_single: false,
    steps,
    coalition,
    seats: coalSeats,
    compatible: coalition.length > 1 ? compatibility(partyMap, coalition) : 1,
    success: coalSeats >= quota,
  };
}

function allocatePortfolios(coalition, partyResults, totalPorts = 20) {
  const members = coalition.map(pid => partyResults.find(p => p.party_id === pid)).filter(Boolean);
  const totalSeats = members.reduce((s, m) => s + m.seats, 0) || 1;
  const exact = members.map(m => m.seats * totalPorts / totalSeats);
  const floors = exact.map(Math.floor);
  let remaining = totalPorts - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (let k = 0; remaining > 0 && k < order.length; k++) { floors[order[k].i] += 1; remaining -= 1; }
  return members.map((m, i) => ({ party_id: m.party_id, party_name: m.party_name, color: m.color, seats: m.seats, portfolios: floors[i] }));
}

export default function CoalitionNegotiationModal({ result, parties, onClose }) {
  const [rerun, setRerun] = useState(0);

  const partyMap = useMemo(() => {
    const m = {};
    (parties || []).forEach(p => { m[p.id] = p; });
    (result?.party_results || []).forEach(p => { if (!m[p.party_id]) m[p.party_id] = { id: p.party_id, name: p.party_name, color: p.color }; });
    return m;
  }, [parties, result]);

  const totalSeats = result?.total_seats || 0;
  const quota = Math.floor(totalSeats / 2) + 1;

  const sim = useMemo(
    () => simulateNegotiation(partyMap, result?.party_results || [], totalSeats, quota, 1 + rerun * 7),
    [partyMap, result, totalSeats, quota, rerun]
  );

  const portfolios = useMemo(
    () => (sim.success ? allocatePortfolios(sim.coalition, result?.party_results || []) : []),
    [sim, result]
  );

  if (!result) return null;
  const accepted = sim.steps.filter(s => s.type === 'accept' || s.type === 'init' || s.type === 'single');

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>组阁谈判模拟</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="copy-btn" onClick={() => setRerun(v => v + 1)}>重新谈判</button>
            <button className="province-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="analysis-body">
          <div className="robust-summary-row">
            <div className="robust-stat">
              <div className="robust-stat-label">组阁者 (Formateur)</div>
              <div className="robust-stat-val" style={{ fontSize: 13 }}>
                {partyMap[sim.formateur]?.name || sim.formateur}
              </div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">谈判结果</div>
              <div className="robust-stat-val" style={{ color: sim.success ? 'var(--accent-green)' : 'var(--accent-orange)', fontSize: 13 }}>
                {sim.success ? (sim.majority_single ? '一党过半' : '组阁成功') : '组阁失败'}
              </div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">联盟席位</div>
              <div className="robust-stat-val">{sim.seats} / {quota}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">成员党数</div>
              <div className="robust-stat-val">{sim.coalition.length}</div>
            </div>
          </div>

          {sim.majority_single ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
              {partyMap[sim.formateur]?.name} 获得 {sim.steps[0].seats} 席，已超半数门槛 {quota} 席，无需谈判即可单独执政。
            </div>
          ) : (
            <>
              <div className="attack-section-title" style={{ marginTop: 10 }}>谈判过程（依意识形态接近度依次邀请）</div>
              <div className="negotiation-list">
                {sim.steps.map((s, i) => (
                  <div key={i} className={`negotiation-step ${s.type}`}>
                    <span className="negotiation-idx">{i + 1}</span>
                    {s.type === 'init' && (
                      <>
                        <span className="negotiation-text">
                          <b>{s.party_name}</b> 受命组阁，提议联合执政（席位 {s.seats} / {quota}）
                        </span>
                        <span className="negotiation-badge init">发起</span>
                      </>
                    )}
                    {s.type === 'accept' && (
                      <>
                        <span className="negotiation-text">
                          <b>{s.party_name}</b>（{s.seats} 席）接受邀请，兼容度 {(s.compat * 100).toFixed(0)}%
                          {s.reached && <span style={{ color: 'var(--accent-green)' }}> → 达成多数！</span>}
                        </span>
                        <span className="negotiation-badge accept">接受</span>
                      </>
                    )}
                    {s.type === 'decline' && (
                      <>
                        <span className="negotiation-text">
                          <b>{s.party_name}</b>（{s.seats} 席）拒绝邀请（兼容度 {(s.compat * 100).toFixed(0)}%，接受意愿 {(s.accept_prob * 100).toFixed(0)}%）
                        </span>
                        <span className="negotiation-badge decline">拒绝</span>
                      </>
                    )}
                    <span className="negotiation-seats">累计 {s.coalSeats}</span>
                  </div>
                ))}
              </div>

              {sim.success && (
                <>
                  <div className="attack-section-title" style={{ marginTop: 12 }}>内阁席位分配（20 个部委，最大余数法）</div>
                  <table className="analysis-table">
                    <thead>
                      <tr><th>执政党</th><th>席位</th><th>部委数</th></tr>
                    </thead>
                    <tbody>
                      {portfolios.map(m => (
                        <tr key={m.party_id}>
                          <td>
                            <span className="coal-dot" style={{ background: m.color || '#888' }} /> {m.party_name}
                          </td>
                          <td>{m.seats}</td>
                          <td style={{ fontWeight: 700 }}>{m.portfolios}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                    联盟总席位 {sim.seats} 席（门槛 {quota}），政策兼容度 {(sim.compatible * 100).toFixed(0)}%。
                  </div>
                </>
              )}
            </>
          )}

          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10 }}>
            模型：第一大党为组阁者，按与组阁者的意识形态距离由近到远依次发出邀请；被邀党以「兼容度 × 席位回报」决定是否入阁。点击「重新谈判」可观察不同随机下的结果。
          </div>
        </div>
      </div>
    </div>
  );
}