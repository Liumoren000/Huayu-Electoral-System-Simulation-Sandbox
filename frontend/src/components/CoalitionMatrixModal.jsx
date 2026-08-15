import React from 'react';

export default function CoalitionMatrixModal({ coalition, result, onClose }) {
  const cm = coalition?.coalition_matrix;
  if (!cm) {
    return (
      <div className="analysis-overlay" onClick={onClose}>
        <div className="analysis-modal" onClick={e => e.stopPropagation()}>
          <div className="analysis-header">
            <h3>联盟可能性矩阵</h3>
            <button className="province-close-btn" onClick={onClose}>✕</button>
          </div>
          <div className="analysis-body" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            暂无联盟数据。
          </div>
        </div>
      </div>
    );
  }

  const threshold = result ? Math.floor(result.total_seats / 2) : 0;
  const minimalRows = cm.rows.filter(r => r.minimal);
  const shown = cm.rows.slice(0, 24);
  const partyColor = {};
  (result?.party_results || []).forEach(p => { partyColor[p.party_id] = p.color; });

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>联盟可能性矩阵（过半需 {threshold + 1} 席）</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div className="robust-summary-row">
            <div className="robust-stat">
              <div className="robust-stat-label">过半联盟总数</div>
              <div className="robust-stat-val">{cm.total}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">最小获胜联盟</div>
              <div className="robust-stat-val" style={{ color: 'var(--accent-blue)' }}>{cm.minimal_count}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">单一政党多数</div>
              <div className="robust-stat-val">{cm.single_party_majority ? '是' : '否'}</div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 6px' }}>
            政党联盟参与度（「出现于最小获胜联盟的次数」是最强议价筹码）：
          </div>
          <table className="analysis-table">
            <thead>
              <tr><th>政党</th><th>最小获胜联盟数</th><th>过半联盟总数</th></tr>
            </thead>
            <tbody>
              {cm.inclusion.slice(0, 8).map(i => (
                <tr key={i.party_id}>
                  <td>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: partyColor[i.party_id] || '#888', marginRight: 6 }} />
                    {i.party_name}
                  </td>
                  <td style={{ fontWeight: 700 }}>{i.minimal_count}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{i.total_count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 6px' }}>
            过半组合（前 {shown.length}，<b style={{ color: 'var(--accent-blue)' }}>蓝字为最小获胜联盟</b>）：
          </div>
          <table className="analysis-table">
            <thead>
              <tr><th>组合</th><th>席位</th><th>冗余</th><th>稳定度</th></tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: r.minimal ? 'var(--accent-blue)' : 'inherit', fontWeight: r.minimal ? 700 : 400 }}>
                    {r.party_names.join(' + ')}
                  </td>
                  <td style={{ fontWeight: 700 }}>{r.total_seats}</td>
                  <td>{r.excess}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{(r.stability_score * 100).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
            {cm.total > 24 ? `仅显示前 24 条（共 ${cm.total} 条）` : ''}· 稳定度综合意识形态距离、政策兼容性与政党数量。
          </div>
        </div>
      </div>
    </div>
  );
}