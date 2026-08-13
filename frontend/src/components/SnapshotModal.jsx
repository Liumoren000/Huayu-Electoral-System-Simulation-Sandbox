import React, { useMemo } from 'react';

export default function SnapshotModal({ snapshots, onRemove, onClear, onClose }) {
  const allPartyIds = useMemo(() => {
    const set = new Set();
    snapshots.forEach(s => (s.result?.party_results || []).forEach(p => set.add(p.party_id)));
    return [...set];
  }, [snapshots]);

  const partyMeta = useMemo(() => {
    const m = {};
    snapshots.forEach(s => (s.result?.party_results || []).forEach(p => {
      if (!m[p.party_id]) m[p.party_id] = { name: p.party_name, color: p.color };
    }));
    return m;
  }, [snapshots]);

  const metricRows = [
    { label: '制度', fn: s => s.result?.system_type || '-' },
    { label: '总席位', fn: s => s.result?.total_seats ?? '-' },
    { label: '过半需', fn: s => Math.floor((s.result?.total_seats ?? 0) / 2) + 1 },
    { label: 'Gallagher', fn: s => s.result ? (s.result.gallagher_index * 100).toFixed(1) + '%' : '-' },
    { label: 'Loosemore', fn: s => s.result ? (s.result.loosemore_hanby * 100).toFixed(1) + '%' : '-' },
    { label: 'Rose指数', fn: s => s.result ? (s.result.rose_index * 100).toFixed(0) : '-' },
    { label: '有效政党数(席)', fn: s => s.result ? s.result.effective_parties_seats.toFixed(2) : '-' },
    { label: '第一大党席位', fn: s => s.result ? Math.max(...s.result.party_results.map(p => p.seats)) : '-' },
    { label: '名额失衡', fn: s => s.result ? (s.result.malapportionment_index * 100).toFixed(1) + '%' : '-' },
    { label: '全国化指数', fn: s => s.result ? (s.result.party_nationalization_index * 100).toFixed(0) : '-' },
  ];

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>多快照并列对比（{snapshots.length} 个快照）</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {snapshots.length > 0 && (
              <button className="run-btn" style={{ padding: '4px 12px', fontSize: 11 }} onClick={onClear}>清空全部</button>
            )}
            <button className="province-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="analysis-body">
          {snapshots.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 20, textAlign: 'center' }}>
              暂无快照。在推演后点击「存入快照」即可把当前结果加入对比（可跨制度/剧本/年份并存）。
            </div>
          ) : (
            <>
              <table className="analysis-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 110 }}>指标</th>
                    {snapshots.map(s => (
                      <th key={s.id} style={{ minWidth: 96 }}>
                        <div>{s.label}</div>
                        <button
                          onClick={() => onRemove(s.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-orange)', cursor: 'pointer', fontSize: 10, padding: 0 }}
                        >✕ 移除</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metricRows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-muted)' }}>{row.label}</td>
                      {snapshots.map(s => <td key={s.id}>{row.fn(s)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 6px' }}>各政党席位对比</div>
              <table className="analysis-table">
                <thead>
                  <tr>
                    <th>政党</th>
                    {snapshots.map(s => <th key={s.id}>{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {allPartyIds.map(pid => {
                    const meta = partyMeta[pid] || {};
                    return (
                      <tr key={pid}>
                        <td>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: meta.color || '#888', marginRight: 6 }} />
                          {meta.name || pid}
                        </td>
                        {snapshots.map(s => {
                          const p = (s.result?.party_results || []).find(x => x.party_id === pid);
                          return <td key={s.id} style={p ? { fontWeight: 600 } : { color: 'var(--text-muted)' }}>{p ? p.seats : 0}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}