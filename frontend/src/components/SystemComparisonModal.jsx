import React, { useEffect, useMemo, useState } from 'react';
import { runSystemComparison } from '../services/api.js';

const SYS_LABEL = {
  FPTP: '简单多数制',
  RUNOFF: '两轮决选制',
  IRV: '即时复决制',
  APPROVAL: '同意投票制',
  BORDA: '波达计分制',
  PR: '比例代表制',
  MMP: '混合比例制',
  PARALLEL: '并立制',
  STV: '单记可让渡制',
};

export default function SystemComparisonModal({ config, totalSeats, minSeats, parties, year, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
        const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
        const d = await runSystemComparison({ year, config: simConfig, parties: enabled });
        setData(d);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const rows = useMemo(() => (data?.systems || []).slice().sort((a, b) => b.total_seats - a.total_seats), [data]);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>制度全景对比 · {year}</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>并行运行 9 种制度…</div>}
          {error && <div style={{ color: '#ff5252', padding: 20 }}>{error}</div>}
          {!loading && !error && data && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                同一选情配置（{totalSeats} 席）下并行运行全部选举制度——直观展示"制度决定结果"：比例性与代表集中度的权衡、Duverger 定律下的政党收敛。
              </div>
              <table className="analysis-table">
                <thead>
                  <tr>
                    <th>制度</th>
                    <th>第一大党</th>
                    <th>首党席位</th>
                    <th>首党得票</th>
                    <th>总席</th>
                    <th>Gallagher</th>
                    <th>有效政党数(票)</th>
                    <th>有效政党数(席)</th>
                    <th>半数党</th>
                    <th>格局</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.system_type} style={s.total_seats <= 0 ? { opacity: 0.5 } : {}}>
                      <td><b>{s.system_type}</b><br /><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{SYS_LABEL[s.system_type] || ''}</span></td>
                      <td>{s.top_party || '-'}</td>
                      <td style={{ fontWeight: 700 }}>{s.top_seats}</td>
                      <td>{(s.top_vote * 100).toFixed(1)}%</td>
                      <td>{s.total_seats}</td>
                      <td style={{ color: (s.gallagher * 100) < 8 ? 'var(--accent-green)' : (s.gallagher * 100) < 25 ? 'var(--accent-orange)' : '#ff5252' }}>
                        {(s.gallagher * 100).toFixed(1)}%
                      </td>
                      <td>{s.eff_parties_vote?.toFixed(1)}</td>
                      <td>{s.eff_parties_seats?.toFixed(1)}</td>
                      <td style={{ color: s.majority_possible ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                        {s.majority_possible ? '✓' : '—'}
                      </td>
                      <td style={{ fontSize: 11 }}>{s.classification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
                注：Gallagher 越低代表越成比例；有效政党数（席）明显低于（票）说明制度把选票集中为大党议席（Duverger 效应）。两轮制第二轮全部席位被首轮前二瓜分，可能出现一党独大。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}