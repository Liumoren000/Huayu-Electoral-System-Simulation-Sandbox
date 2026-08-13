import React, { useMemo } from 'react';

export default function RollingCountModal({ data, step, playing, onPlay, onClose }) {
  const cur = data?.steps?.[step];
  const progress = data && cur ? Math.round((cur.counted / cur.total) * 100) : 0;

  const partyRows = useMemo(() => {
    if (!cur) return [];
    return Object.keys(cur.party_seats)
      .map(pid => ({ pid, seats: cur.party_seats[pid] || 0 }))
      .sort((a, b) => b.seats - a.seats);
  }, [cur]);

  return (
    <div className="rolling-overlay" onClick={e => e.stopPropagation()}>
      <div className="rolling-overlay-header">
        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent-blue)' }}>
          选举日直播
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {data?.final_leader_name ? `最终领先: ${data.final_leader_name}` : '加载中…'}
        </span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="toolbar-btn" onClick={onPlay}>
            {playing ? '⏸ 暂停' : (cur && step >= (data?.steps?.length || 1) - 1 ? '↻ 重播' : '▶ 播放')}
          </button>
          <button className="toolbar-btn" onClick={onClose} title="退出直播">✕ 退出</button>
        </div>
      </div>

      {data && cur && (
        <div className="rolling-overlay-body">
          <div className="rolling-progress">
            <div className="rolling-progress-bar">
              <div className="rolling-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="rolling-progress-label">
              已开 {cur.counted} / {cur.total} 选区 · {progress}% · 步 {cur.step}/{data.steps.length}
            </div>
          </div>

          <div className="robust-summary-row" style={{ marginTop: 8 }}>
            <div className="robust-stat">
              <div className="robust-stat-label">当前领先</div>
              <div className="robust-stat-val" style={{ fontSize: 12 }}>
                <span style={{ color: data.party_colors?.[cur.leader_party_id] || '#fff' }}>●</span>{' '}
                {data.party_names?.[cur.leader_party_id]}
              </div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">领先席位</div>
              <div className="robust-stat-val">{cur.leader_seats}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">过半门槛</div>
              <div className="robust-stat-val">{data.quota}</div>
            </div>
            <div className="robust-stat">
              <div className="robust-stat-label">过半可能</div>
              <div className="robust-stat-val" style={{ color: cur.majority_reachable ? 'var(--accent-green)' : 'var(--accent-orange)', fontSize: 11 }}>
                {cur.majority_reachable ? '仍可达' : '已无望'}
              </div>
            </div>
          </div>

          <table className="analysis-table" style={{ marginTop: 8, fontSize: 10 }}>
            <thead>
              <tr><th>政党</th><th>席位</th></tr>
            </thead>
            <tbody>
              {partyRows.slice(0, 5).map(r => (
                <tr key={r.pid} className={r.pid === cur.leader_party_id ? 'gov-row' : ''}>
                  <td>
                    <span className="coal-dot" style={{ background: data.party_colors?.[r.pid] || '#888' }} />{' '}
                    {data.party_names?.[r.pid] || r.pid}
                    {r.pid === cur.leader_party_id && <span style={{ color: 'var(--accent-green)', fontSize: 9, marginLeft: 4 }}>领先</span>}
                  </td>
                  <td style={{ fontWeight: 700 }}>{r.seats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}