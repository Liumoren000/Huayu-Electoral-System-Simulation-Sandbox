import React, { useState, useEffect } from 'react';
import { runElectionForensics } from '../services/api.js';

const CHECK_LABELS = {
  benford: { name: 'Benford 首位数', desc: '真实政党得票数首位近似对数分布（1 最多，9 最少）' },
  last_digit: { name: '末位数字均匀性', desc: '手工/真实计票末位近似均匀，无规律凑整' },
  competition_turnout: { name: '投票率-竞争度关联', desc: '胶着选区投票率更高，碾压选区偏低' },
  marginal_seats: { name: '边际选区密度', desc: '胜差 5% 内的胶着选区占比贴近现实多数制' },
};

export default function ForensicsModal({ config, parties, year, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await runElectionForensics({ year, config, parties });
        setData(res);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [parties, year]);

  const scoreColor = (s) => {
    if (s >= 0.75) return 'var(--accent-blue)';
    if (s >= 0.55) return 'var(--accent-orange)';
    return '#f85149';
  };

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>选举取证审计 · 数据真实性</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          {loading && <div style={{ fontSize: 12, color: 'var(--accent-blue)' }}>审计中...</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{error}</div>}
          {data && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: scoreColor(data.realism_score / 100) }}>
                  {data.realism_score}
                </span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                    真实性评分 / 100
                  </div>
                  <div style={{ fontSize: 11, color: scoreColor(data.realism_score / 100) }}>
                    {data.verdict}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                {data.note}
              </div>

              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '2px 6px' }}>检验项</th>
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>得分</th>
                    <th style={{ textAlign: 'left', padding: '2px 6px' }}>关键统计</th>
                    <th style={{ textAlign: 'left', padding: '2px 6px' }}>结论</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(CHECK_LABELS).map(k => (
                    <tr key={k} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '4px 6px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {CHECK_LABELS[k].name}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: scoreColor(data.scores[k]) }}>
                        {Math.round(data.scores[k] * 100)}
                      </td>
                      <td style={{ padding: '4px 6px', color: 'var(--text-muted)' }}>
                        {k === 'benford' && <>chi² {data.checks.benford.chi2}</>}
                        {k === 'last_digit' && <>均匀度 {data.checks.last_digit.uniformity}</>}
                        {k === 'competition_turnout' && <>ρ {data.checks.competition_turnout.spearman_rho}</>}
                        {k === 'marginal_seats' && <>{(data.checks.marginal_seats.share * 100).toFixed(1)}%</>}
                      </td>
                      <td style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}>
                        {data.checks[k].conclusion}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {Object.keys(CHECK_LABELS).map(k => (
                  <div key={k} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 6, padding: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{CHECK_LABELS[k].name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {CHECK_LABELS[k].desc}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}