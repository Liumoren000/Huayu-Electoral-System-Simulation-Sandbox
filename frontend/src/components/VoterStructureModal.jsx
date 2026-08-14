import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { fetchVoterStructure } from '../services/api.js';

const DIM_ORDER = ['age', 'education', 'urban_rural', 'income'];
const DIM_ICONS = { age: '年龄', education: '教育', urban_rural: '城乡', income: '收入' };

function makeBarOption(data, parties, scopeLabel) {
  const groupLabels = data.map(g => g.label);
  const series = parties.map(p => ({
    name: p.party_name,
    type: 'bar',
    stack: 'total',
    barMaxWidth: 42,
    itemStyle: { color: p.color },
    data: data.map(g => +(g.shares[p.party_id] * 100).toFixed(1)),
  }));
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: ps => {
        const g = data[ps[0].dataIndex];
        let h = `<b>${g.label}（${g.labelPct || ''}）</b><br/>`;
        [...ps].sort((a, b) => b.value - a.value).forEach(p => {
          h += `<span style="display:inline-block;width:10px;height:10px;background:${p.color};margin-right:4px;border-radius:2px"></span>${p.name}: <b>${p.value.toFixed(1)}%</b><br/>`;
        });
        return h;
      },
    },
    legend: {
      data: parties.map(p => p.party_name),
      type: 'scroll',
      textStyle: { color: '#c9d1d9', fontSize: 10 },
      top: 0,
    },
    grid: { left: 70, right: 20, top: 30, bottom: 26 },
    xAxis: {
      type: 'value',
      max: 100,
      name: '得票率 %',
      nameTextStyle: { color: '#8b949e', fontSize: 10 },
      axisLabel: { color: '#8b949e', fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#21262d' } },
    },
    yAxis: {
      type: 'category',
      data: groupLabels,
      axisLabel: { color: '#c9d1d9', fontSize: 11 },
      axisLine: { lineStyle: { color: '#30363d' } },
      axisTick: { show: false },
    },
    series,
  };
}

export default function VoterStructureModal({ year, config, totalSeats, minSeats, parties, cities, result, onClose }) {
  const [scope, setScope] = useState('全国');
  const [activeDim, setActiveDim] = useState('age');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);

  const provinces = useMemo(() => {
    const set = new Set((cities?.cities || []).map(c => c.province));
    return [...set].sort();
  }, [cities]);

  const partyMeta = useMemo(() => {
    const list = result?.party_results || [];
    return Object.fromEntries(list.map(p => [p.party_id, p]));
  }, [result]);

  // 席位赢家 = 主表第一行（保证与界面完全一致）
  const winner = useMemo(() => {
    const list = [...(result?.party_results || [])];
    if (!list.length) return null;
    return list.reduce((a, b) => (b.seats > a.seats ? b : a));
  }, [result]);

  const runner = useMemo(() => {
    const list = [...(result?.party_results || [])];
    if (list.length < 2) return null;
    const sorted = [...list].sort((a, b) => b.seats - a.seats);
    return sorted[1] || null;
  }, [result]);

  const voteLeader = useMemo(() => {
    const list = [...(result?.party_results || [])];
    if (!list.length) return null;
    return list.reduce((a, b) => (b.vote_share > a.vote_share ? b : a));
  }, [result]);

  const run = async (scopeVal) => {
    setLoading(true);
    setError(null);
    try {
      const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
      const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const d = await fetchVoterStructure({ year, scope: scopeVal, config: simConfig, parties: enabled });
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(scope); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);

  useEffect(() => {
    if (!data || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const dim = data.dimensions[activeDim];
    if (!dim) return;
    const partyIds = Object.keys(dim.groups[0]?.shares || {});
    const partiesList = partyIds.map(pid => ({
      party_id: pid,
      party_name: partyMeta[pid]?.party_name || pid,
      color: partyMeta[pid]?.color || '#8896a5',
    }));

    const groups = dim.groups.map(g => ({
      ...g,
      labelPct: data.total_population ? `${((g.weight / data.total_population) * 100).toFixed(0)}%人口` : '',
    }));
    chart.setOption(makeBarOption(groups, partiesList, data.scope), true);
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [data, activeDim, partyMeta]);

  const winnerNarrative = useMemo(() => {
    if (!data || !winner || !runner) return [];
    const lines = [];
    const dim = data.dimensions[activeDim];
    if (!dim) return lines;
    const pct = pop => (data.total_population && pop ? ((pop / data.total_population) * 100).toFixed(0) : 0);
    const wShare = g => (g.shares[winner.party_id] || 0) * 100;
    const rShare = g => (g.shares[runner.party_id] || 0) * 100;
    const sorted = [...dim.groups].sort((a, b) => (wShare(b) - rShare(b)) - (wShare(a) - rShare(a)));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const wBest = wShare(best), rBest = rShare(best);
    const isVoteLeader = voteLeader?.party_id === winner.party_id;
    if (!isVoteLeader) {
      lines.push(`在${dim.label}中，${winner.party_name}的全国得票率（${(winner.vote_share * 100).toFixed(1)}%）略低于得票第一的${voteLeader?.party_name}，但凭借在「${best.label}」（占人口${pct(best.weight)}%）等群体的相对优势赢得${winner.seats}席。`);
    }
    lines.push(`在${dim.label}中，${winner.party_name}在「${best.label}」（占人口${pct(best.weight)}%）得票最高（${wBest.toFixed(1)}%），对主要对手${runner.party_name}的优势达 ${(wBest - rBest).toFixed(1)} 个百分点。`);
    if (worst !== best) {
      const wWorst = wShare(worst), rWorst = rShare(worst);
      lines.push(`而在「${worst.label}」（占人口${pct(worst.weight)}%），${runner.party_name}以${rWorst.toFixed(1)}%领先${winner.party_name}的${wWorst.toFixed(1)}%，这是${winner.party_name}的薄弱环节。`);
    }
    return lines;
  }, [data, winner, runner, voteLeader, activeDim]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <span style={{ fontWeight: 700 }}>选民结构构成</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>按年龄/教育/城乡/收入拆分解读"为什么赢"</span>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body" style={{ padding: 12, overflowY: 'auto', maxHeight: '75vh' }}>
          {error && <div style={{ color: '#ff7043', fontSize: 12, marginBottom: 8 }}>加载失败：{error}</div>}
          {loading && !data && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>计算中…</div>}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              统计范围：
              <select value={scope} onChange={e => setScope(e.target.value)}
                style={{ marginLeft: 6, background: 'var(--panel-bg)', color: 'var(--text)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '2px 6px' }}>
                <option value="全国">全国</option>
                {provinces.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {DIM_ORDER.map(d => (
                <button key={d}
                  className={`header-btn ${activeDim === d ? 'active' : ''}`}
                  onClick={() => setActiveDim(d)}
                  style={{ padding: '3px 10px', fontSize: 11 }}>
                  {DIM_ICONS[d]}
                </button>
              ))}
            </div>
          </div>

          {data && winner && (
            <div className="robust-summary-row" style={{ marginBottom: 10 }}>
              <div className="robust-stat">
                <div className="robust-stat-label">{data.scope} · 席位赢家</div>
                <div className="robust-stat-val" style={{ color: winner.color }}>
                  {winner.party_name}（{winner.seats} 席）
                </div>
              </div>
              <div className="robust-stat">
                <div className="robust-stat-label">得票率第一</div>
                <div className="robust-stat-val" style={{ color: voteLeader?.color }}>
                  {voteLeader?.party_name}（{(voteLeader?.vote_share * 100).toFixed(1)}%）
                </div>
              </div>
              {runner && (
                <div className="robust-stat">
                  <div className="robust-stat-label">次席</div>
                  <div className="robust-stat-val" style={{ color: runner.color }}>
                    {runner.party_name}（{runner.seats} 席）
                  </div>
                </div>
              )}
              <div className="robust-stat">
                <div className="robust-stat-label">统计城市</div>
                <div className="robust-stat-val">{data.city_count} 市</div>
              </div>
            </div>
          )}

          <div ref={chartRef} style={{ width: '100%', height: 300 }} />

          {winner && winnerNarrative.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                📊 为什么是「{winner.party_name}」赢下{winner.seats}席（{data?.dimensions?.[activeDim]?.label}）
              </div>
              {winnerNarrative.map((l, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 3 }}>· {l}</div>
              ))}
            </div>
          )}

          {data && (
            <table className="analysis-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>人口群体</th>
                  <th>人口占比</th>
                  {Object.keys(data.dimensions[activeDim]?.groups?.[0]?.shares || {}).map(pid => {
                    const col = partyMeta[pid]?.color || '#8896a5';
                    return <th key={pid} style={{ color: col }}>{partyMeta[pid]?.party_name || pid}</th>;
                  })}
                  <th>该群体赢家</th>
                </tr>
              </thead>
              <tbody>
                {(data.dimensions[activeDim]?.groups || []).map(g => (
                  <tr key={g.key}>
                    <td>{g.label}</td>
                    <td>{data.total_population ? `${((g.weight / data.total_population) * 100).toFixed(1)}%` : '-'}</td>
                    {Object.keys(g.shares).map(pid => (
                      <td key={pid}>{(g.shares[pid] * 100).toFixed(1)}%</td>
                    ))}
                    <td>{partyMeta[g.winner]?.party_name || g.winner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
