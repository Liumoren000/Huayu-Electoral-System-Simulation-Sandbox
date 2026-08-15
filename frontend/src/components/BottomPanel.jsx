import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { findCoalitions } from '../utils/coalition.js';

export default function BottomPanel({ result }) {
  const [showUpper, setShowUpper] = useState(false);
  const [chartType, setChartType] = useState('hemicycle');

  const hasUpper = result?.upper_house_total_seats > 0;
  const upperParties = result?.upper_house_party_results || [];
  const upperTotal = result?.upper_house_total_seats || 0;

  const effN = (shares) => {
    const s = shares.filter(v => v > 0);
    const total = s.reduce((a, b) => a + b, 0);
    if (!total) return 0;
    return s.reduce((a, b) => a + (b / total) ** 2, 0) > 0 ? 1 / s.reduce((a, b) => a + (b / total) ** 2, 0) : 0;
  };
  const upperVoteShares = upperParties.map(p => p.vote_share || 0);
  const upperSeatShares = upperParties.map(p => upperTotal ? p.seats / upperTotal : 0);
  const upperEffVote = upperVoteShares.length ? effN(upperVoteShares) : 0;
  const upperEffSeats = upperSeatShares.length ? effN(upperSeatShares) : 0;
  const upperGallagher = (() => {
    if (!upperParties.length || !result?.party_results?.length) return 0;
    const lh = upperParties.map((p, i) => {
      const vs = p.vote_share || 0;
      const ss = upperTotal ? p.seats / upperTotal : 0;
      return Math.abs(vs - ss);
    });
    return lh.reduce((a, b) => a + b, 0) / 2;
  })();
  const upperCoalition = hasUpper ? findCoalitions(
    { party_results: upperParties, total_seats: upperTotal },
    result?.party_results || []
  ) : null;
  const isUpper = showUpper && hasUpper;

  const metricsBar = result ? (
    <div className="metrics-bar">
      <div className="metric-item">
        <span className="metric-label">格局类型</span>
        <span className="metric-value" style={{ color: 'var(--accent-blue)' }}>
          {isUpper ? '-' : (result.party_system_classification || '-')}
        </span>
      </div>
      <div className="metric-item">
        <span className="metric-label">有效政党数(票)</span>
        <span className="metric-value">{isUpper ? (upperEffVote ? upperEffVote.toFixed(1) : '-') : (result.effective_parties_vote?.toFixed(1) || '-')}</span>
      </div>
      <div className="metric-item">
        <span className="metric-label">有效政党数(席)</span>
        <span className="metric-value">{isUpper ? (upperEffSeats ? upperEffSeats.toFixed(1) : '-') : (result.effective_parties_seats?.toFixed(1) || '-')}</span>
      </div>
      <div className="metric-item">
        <span className="metric-label">Gallagher</span>
        <span className="metric-value">{isUpper ? (upperGallagher ? (upperGallagher * 100).toFixed(1) + '%' : '-') : (result.gallagher_index ? (result.gallagher_index * 100).toFixed(1) + '%' : '-')}</span>
      </div>
      <div className="metric-item">
        <span className="metric-label">Loosemore-Hanby</span>
        <span className="metric-value">{isUpper ? '-' : (result.loosemore_hanby !== undefined ? (result.loosemore_hanby * 100).toFixed(1) + '%' : '-')}</span>
      </div>
      <div className="metric-item">
        <span className="metric-label">Rose指数</span>
        <span className="metric-value" style={{ color: isUpper ? 'var(--text-muted)' : ((result.rose_index ?? 0) > 0.8 ? 'var(--accent-green)' : 'var(--text-primary)') }}>
          {isUpper ? '-' : (result.rose_index !== undefined ? (result.rose_index * 100).toFixed(1) + '%' : '-')}
        </span>
      </div>
      <div className="metric-item">
        <span className="metric-label">Malapportionment</span>
        <span className="metric-value">{isUpper ? '-' : (result.malapportionment_index !== undefined ? (result.malapportionment_index * 100).toFixed(1) + '%' : '-')}</span>
      </div>
      <div className="metric-item">
        <span className="metric-label">政党国家化</span>
        <span className="metric-value">{isUpper ? '-' : (result.party_nationalization_index !== undefined ? (result.party_nationalization_index * 100).toFixed(0) + '%' : '-')}</span>
      </div>
      <div className="metric-item">
        <span className="metric-label">极化度</span>
        <span className="metric-value" style={{ color: (result.polarization_index ?? 0) > 0.5 ? 'var(--accent-orange)' : 'var(--text-primary)' }}>
          {isUpper ? '-' : (result.polarization_index !== undefined ? (result.polarization_index * 100).toFixed(0) : '-')}
        </span>
      </div>
    </div>
  ) : null;

  if (!result) {
    return (
      <div className="bottom-panel">
        {metricsBar}
        <div className="bottom-panel-content">
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
      </div>
    );
  }

  const activeResult = showUpper && hasUpper ? {
    ...result,
    party_results: result.upper_house_party_results,
    total_seats: result.upper_house_total_seats,
    system_type: '上议院',
  } : result;

  return (
    <div className="bottom-panel">
      {metricsBar}
      <div className="bottom-panel-content">
      <div className="bottom-cell">
        <div className="bottom-cell-title">
          {chartType === 'hemicycle' ? '议会席位分布' : chartType === 'spectrum' ? '政党光谱' : '席位-得票'}
          <div className="house-toggle">
            {hasUpper && (
              <>
                <button
                  className={`house-btn ${!showUpper ? 'active' : ''}`}
                  onClick={() => setShowUpper(false)}
                  title="下议院/众议院席位"
                >
                  下议院
                </button>
                <button
                  className={`house-btn ${showUpper ? 'active' : ''}`}
                  onClick={() => setShowUpper(true)}
                  title="上议院席位"
                >
                  上议院
                </button>
              </>
            )}
            <button
              className={`house-btn ${chartType === 'hemicycle' ? 'active' : ''}`}
              onClick={() => setChartType('hemicycle')}
            >
              半圆
            </button>
            <button
              className={`house-btn ${chartType === 'spectrum' ? 'active' : ''}`}
              onClick={() => setChartType('spectrum')}
            >
              光谱
            </button>
            <button
              className={`house-btn ${chartType === 'scatter' ? 'active' : ''}`}
              onClick={() => setChartType('scatter')}
            >
              散点
            </button>
          </div>
        </div>
        {chartType === 'hemicycle' && (
          <Hemicycle result={activeResult} label={activeResult.system_type} color={showUpper && hasUpper ? 'var(--accent-purple)' : 'var(--accent-blue)'} />
        )}
        {chartType === 'spectrum' && (
          <PartySpectrum result={activeResult} />
        )}
        {chartType === 'scatter' && (
          <SeatVoteScatter result={activeResult} />
        )}
      </div>
      <div className="bottom-cell">
        <div className="bottom-cell-title">政党得票 & 席位</div>
        <SeatTable result={activeResult} />
      </div>
      <div className="bottom-cell">
        <div className="bottom-cell-title">组阁推演{isUpper ? '·上议院' : ''}</div>
        <CoalitionBlock coalition={isUpper ? upperCoalition : result.coalition} />
      </div>
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
    <div>
      <div className="seats-bar">
        {result.party_results
          .filter(p => p.seats > 0)
          .sort((a, b) => b.seats - a.seats)
          .map(p => (
            <div
              key={p.party_id}
              className="seats-seg"
              style={{
                background: p.color,
                width: `${(p.seats / result.total_seats) * 100}%`,
              }}
              title={`${p.party_name}: ${p.seats}席 (${((p.seats / result.total_seats) * 100).toFixed(1)}%)`}
            >
              {p.seats > 10 ? p.seats : ''}
            </div>
          ))}
      </div>
      <table className="result-table">
        <thead>
          <tr>
            <th>政党</th>
            <th>席位</th>
            <th>得票率</th>
            <th>占比</th>
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
    </div>
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
      {coalition.power_indices && coalition.power_indices.length > 0 && (
        <div className="coalition-alternatives" style={{ marginTop: 6 }}>
          <div className="coalition-alt-title">博弈论权力指数 (Banzhaf / Shapley-Shubik)</div>
          {coalition.power_indices
            .filter(p => p.banzhaf > 0)
            .sort((a, b) => b.banzhaf - a.banzhaf)
            .slice(0, 5)
            .map(p => (
              <div key={p.party_id} className="coalition-alt-row">
                <span className="coalition-alt-parties">
                  {p.party_name}
                  {p.pivotal && <span style={{ color: 'var(--accent-orange)', marginLeft: 4 }}>⚑关键少数</span>}
                </span>
                <span className="coalition-alt-scores">
                  {p.seats}席 · B{(p.banzhaf * 100).toFixed(1)}% / S{(p.shapley_shubik * 100).toFixed(1)}%
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function PartySpectrum({ result }) {
  if (!result) return null;

  const parties = result.party_results.filter(p => p.seats > 0);
  if (parties.length === 0) return null;

  const width = 240;
  const height = 100;
  const padding = 15;

  return (
    <div className="party-spectrum">
      <svg viewBox={`0 0 ${width} ${height}`} className="spectrum-svg">
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#2a3344" strokeWidth="0.5" />
        <line x1={width / 2} y1={padding} x2={width / 2} y2={height - padding} stroke="#2a3344" strokeWidth="0.5" />

        <text x={padding} y={height - 2} fontSize="7" fill="#5a6378">←经济</text>
        <text x={width - padding - 20} y={height - 2} fontSize="7" fill="#5a6378">经济→</text>
        <text x={2} y={padding + 3} fontSize="7" fill="#5a6378">↑社会</text>
        <text x={2} y={height - padding} fontSize="7" fill="#5a6378">↓</text>

        {parties.map(p => {
          const x = width / 2 + (p.economic_position || 0) * (width / 2 - padding);
          const y = height / 2 - (p.social_position || 0) * (height / 2 - padding);
          const r = Math.max(4, Math.min(12, p.seats / 10));
          return (
            <g key={p.party_id}>
              <circle cx={x} cy={y} r={r} fill={p.color} opacity="0.8" stroke="#0a0e14" strokeWidth="0.5" />
              <text x={x} y={y - r - 2} fontSize="6" fill="#e8eaed" textAnchor="middle">{p.party_name.slice(0, 4)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SeatVoteScatter({ result }) {
  if (!result) return null;

  const parties = result.party_results.filter(p => p.seats > 0);
  if (parties.length === 0) return null;

  const width = 240;
  const height = 100;
  const padding = 15;
  const maxVal = Math.max(
    ...parties.map(p => p.vote_share),
    ...parties.map(p => p.seats / result.total_seats)
  );

  return (
    <div className="seat-vote-scatter">
      <svg viewBox={`0 0 ${width} ${height}`} className="scatter-svg">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#2a3344" strokeWidth="0.5" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#2a3344" strokeWidth="0.5" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={padding} stroke="#4fc3d7" strokeWidth="0.5" strokeDasharray="2,2" />

        <text x={width / 2} y={height - 2} fontSize="7" fill="#5a6378" textAnchor="middle">得票率→</text>
        <text x={2} y={height / 2} fontSize="7" fill="#5a6378" transform={`rotate(-90, 2, ${height / 2})`}>席位占比→</text>

        {parties.map(p => {
          const x = padding + (p.vote_share / maxVal) * (width - 2 * padding);
          const y = height - padding - (p.seats / result.total_seats / maxVal) * (height - 2 * padding);
          return (
            <g key={p.party_id}>
              <circle cx={x} cy={y} r={4} fill={p.color} opacity="0.8" stroke="#0a0e14" strokeWidth="0.5" />
              <text x={x + 6} y={y + 3} fontSize="6" fill="#e8eaed">{p.party_name.slice(0, 4)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
