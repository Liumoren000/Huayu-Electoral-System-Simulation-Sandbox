import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';

export default function BottomPanel({ result }) {
  const [showUpper, setShowUpper] = useState(false);

  if (!result) {
    return (
      <div className="bottom-panel">
        <div className="bottom-cell">
          <div className="bottom-cell-title">议会席位</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: 20, textAlign: 'center' }}>
            点击"运行推演"查看结果
          </div>
        </div>
        <div className="bottom-cell">
          <div className="bottom-cell-title">政党得票率</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: 20, textAlign: 'center' }}>
            等待数据...
          </div>
        </div>
        <div className="bottom-cell">
          <div className="bottom-cell-title">组阁推演</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: 20, textAlign: 'center' }}>
            等待推演...
          </div>
        </div>
      </div>
    );
  }

  const hasUpper = result.upper_house_total_seats > 0;
  const activeResult = showUpper && hasUpper ? {
    ...result,
    party_results: result.upper_house_party_results,
    total_seats: result.upper_house_total_seats,
    system_type: '上议院',
  } : result;

  return (
    <div className="bottom-panel">
      <div className="bottom-cell">
        <div className="bottom-cell-title">
          议会席位分布
          {hasUpper && (
            <div className="house-toggle">
              <button
                className={`house-btn ${!showUpper ? 'active' : ''}`}
                onClick={() => setShowUpper(false)}
              >
                下议院
              </button>
              <button
                className={`house-btn ${showUpper ? 'active' : ''}`}
                onClick={() => setShowUpper(true)}
              >
                上议院
              </button>
            </div>
          )}
        </div>
        <Hemicycle result={activeResult} label={activeResult.system_type} color={showUpper && hasUpper ? 'var(--accent-purple)' : 'var(--accent-blue)'} />
      </div>
      <div className="bottom-cell">
        <div className="bottom-cell-title">政党得票 & 席位</div>
        <SeatTable result={activeResult} />
      </div>
      <div className="bottom-cell">
        <div className="bottom-cell-title">组阁推演</div>
        <CoalitionBlock coalition={result.coalition} />
      </div>
    </div>
  );
}

function Hemicycle({ result, label, color }) {
  if (!result) return null;

  const parties = result.party_results.filter(p => p.seats > 0).sort((a, b) => b.seats - a.seats);
  const total = parties.reduce((sum, p) => sum + p.seats, 0);
  if (total === 0) return null;

  const cx = 130;
  const cy = 95;
  const rowCount = Math.max(3, Math.min(8, Math.ceil(total / 10)));
  const baseRadius = 18;
  const rowStep = 12;
  const dotRadius = Math.min(3.5, Math.max(2, 60 / Math.sqrt(total)));

  const rowWeights = [];
  let weightSum = 0;
  for (let row = 0; row < rowCount; row++) {
    const w = baseRadius + row * rowStep;
    rowWeights.push(w);
    weightSum += w;
  }

  const rowSeats = [];
  let assigned = 0;
  for (let row = 0; row < rowCount; row++) {
    const proportion = rowWeights[row] / weightSum;
    const seatsForRow = Math.max(1, Math.round(proportion * total));
    rowSeats.push(seatsForRow);
    assigned += seatsForRow;
  }

  let diff = assigned - total;
  while (diff > 0) {
    const maxIdx = rowSeats.indexOf(Math.max(...rowSeats));
    if (rowSeats[maxIdx] > 1) { rowSeats[maxIdx]--; diff--; }
    else break;
  }
  while (diff < 0) {
    const minIdx = rowSeats.indexOf(Math.min(...rowSeats));
    rowSeats[minIdx]++; diff++;
  }

  const seats = [];
  let seatIdx = 0;

  for (let row = 0; row < rowCount && seatIdx < total; row++) {
    const radius = baseRadius + row * rowStep;
    const seatsInRow = rowSeats[row];
    const angleStart = Math.PI * 0.92;
    const angleEnd = Math.PI * 0.08;
    const angleSpan = angleStart - angleEnd;

    for (let col = 0; col < seatsInRow && seatIdx < total; col++) {
      const fraction = seatsInRow > 1 ? col / (seatsInRow - 1) : 0.5;
      const angle = angleStart - fraction * angleSpan;
      const x = cx + Math.cos(angle) * radius;
      const y = cy - Math.sin(angle) * radius * 0.55;

      let currentParty = null;
      let cumulative = 0;
      for (const party of parties) {
        cumulative += party.seats;
        if (seatIdx < cumulative) {
          currentParty = party;
          break;
        }
      }
      if (!currentParty) currentParty = parties[parties.length - 1];

      seats.push({ x, y, color: currentParty.color, name: currentParty.party_name });
      seatIdx++;
    }
  }

  return (
    <div>
      <div style={{ fontSize: 11, color, fontWeight: 600, marginBottom: 2 }}>{label} ({result.total_seats}席)</div>
      <svg viewBox="0 0 260 100" className="hemicycle-svg">
        <path
          d={`M ${cx - baseRadius - rowStep * rowCount + 5},${cy + 3} L ${cx + baseRadius + rowStep * rowCount - 5},${cy + 3}`}
          fill="none"
          stroke="#2a3344"
          strokeWidth="0.8"
        />
        {seats.map((seat, i) => (
          <circle
            key={i}
            cx={seat.x}
            cy={seat.y}
            r={dotRadius}
            fill={seat.color}
            stroke="#0a0e14"
            strokeWidth={0.4}
          >
            <title>{seat.name}</title>
          </circle>
        ))}
      </svg>
      <div className="hemicycle-legend">
        {parties.map(p => (
          <div key={p.party_id} className="hemicycle-legend-item">
            <span className="hemicycle-legend-dot" style={{ background: p.color }} />
            <span className="hemicycle-legend-name">{p.party_name}</span>
            <span className="hemicycle-legend-seats">{p.seats}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeatTable({ result }) {
  if (!result) return null;

  return (
    <table className="result-table">
      <thead>
        <tr>
          <th>政党</th>
          <th>席位</th>
          <th>得票率</th>
          <th>席位占比</th>
        </tr>
      </thead>
      <tbody>
        {result.party_results
          .sort((a, b) => b.seats - a.seats)
          .map(p => (
            <tr key={p.party_id}>
              <td>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: p.color, marginRight: 4 }} />
                {p.party_name}
              </td>
              <td style={{ fontWeight: 600 }}>{p.seats}</td>
              <td style={{ color: 'var(--text-muted)' }}>{(p.vote_share * 100).toFixed(1)}%</td>
              <td style={{ color: 'var(--text-muted)' }}>{((p.seats / result.total_seats) * 100).toFixed(1)}%</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function CoalitionBlock({ coalition }) {
  if (!coalition) return <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>无数据</div>;

  return (
    <div>
      {coalition.has_majority ? (
        <div className="coalition-mini recommended">
          <div className="coalition-mini-title">
            单一政党多数 {coalition.majority_type === 'absolute' ? '(绝对多数)' : '(简单多数)'}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{coalition.majority_party_name}</div>
        </div>
      ) : coalition.recommended_coalition ? (
        <>
          <div className="coalition-mini recommended">
            <div className="coalition-mini-title">★ 推荐联盟 ({coalition.recommended_coalition.majority_type === 'comfortable' ? '舒适多数' : '微弱多数'})</div>
            <div className="coalition-parties-row">
              {coalition.recommended_coalition.party_names.map((n, i) => (
                <span key={i} className="coalition-party-pill">{n}</span>
              ))}
            </div>
            <div className="coalition-scores">
              <div className="coalition-score">
                <span className="score-label">席位</span>
                <span className="score-val">{coalition.recommended_coalition.total_seats}</span>
              </div>
              <div className="coalition-score">
                <span className="score-label">稳定</span>
                <span className="score-val" style={{ color: coalition.recommended_coalition.stability_score > 0.6 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                  {(coalition.recommended_coalition.stability_score * 100).toFixed(0)}%
                </span>
              </div>
              <div className="coalition-score">
                <span className="score-label">兼容</span>
                <span className="score-val">{(coalition.recommended_coalition.policy_compatibility * 100).toFixed(0)}%</span>
              </div>
              <div className="coalition-score">
                <span className="score-label">距离</span>
                <span className="score-val">{coalition.recommended_coalition.ideological_distance.toFixed(1)}</span>
              </div>
            </div>
          </div>
          {coalition.coalition_options.length > 1 && (
            <div className="coalition-alternatives">
              <div className="coalition-alt-title">其他可行方案</div>
              {coalition.coalition_options.slice(1, 4).map((opt, i) => (
                <div key={i} className="coalition-alt-row">
                  <span className="coalition-alt-parties">{opt.party_names.join(' + ')}</span>
                  <span className="coalition-alt-scores">
                    {opt.total_seats}席 | 稳{(opt.stability_score * 100).toFixed(0)}% | 兼{(opt.policy_compatibility * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>无法形成多数</div>
      )}
    </div>
  );
}
