import React, { useMemo } from 'react';

export default function RollingCountModal({ data, step, playing, speed, onSpeedChange, onPlay, onClose }) {
  const cur = data?.steps?.[step];
  const prev = data?.steps?.[step - 1];
  const isLast = data && step >= data.steps.length - 1;
  const progress = data && cur ? Math.round((cur.counted / cur.total) * 100) : 0;

  const leadChanged = useMemo(() => {
    if (!cur || !prev) return false;
    return cur.leader_party_id !== prev.leader_party_id;
  }, [cur, prev]);

  const lostQuota = useMemo(() => {
    if (!cur || !prev) return false;
    return !cur.majority_reachable && prev.majority_reachable;
  }, [cur, prev]);

  const partyRows = useMemo(() => {
    if (!cur) return [];
    return Object.keys(cur.party_seats)
      .map(pid => ({ pid, seats: cur.party_seats[pid] || 0 }))
      .sort((a, b) => b.seats - a.seats);
  }, [cur]);

  const pct = progress;
  const phase =
    pct < 15 ? '开场 · 各市陆续开箱' :
    pct < 40 ? '已开票两成 · 城市清点中' :
    pct < 60 ? '过半悬念渐显 · 关键城市陆续揭晓' :
    pct < 85 ? '大局将定 · 逐城核对中' :
    pct < 99 ? '尾声 · 仅剩零星选区' : '全部开票 · 尘埃落定';

  return (
    <div className="rolling-overlay" onClick={e => e.stopPropagation()}>
      <div className="rolling-overlay-header">
        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent-blue)' }}>
          选举日直播
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {data?.final_leader_name ? `最终领先: ${data.final_leader_name}` : '加载中…'}
        </span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
          <button
            className="toolbar-btn"
            style={{ fontSize: 10, padding: '2px 6px' }}
            onClick={() => onSpeedChange(speed === 200 ? 600 : speed === 600 ? 1000 : 200)}
            title="切换播放速度"
          >
            速度 {speed === 200 ? '快' : speed === 600 ? '中' : '慢'}
          </button>
          <button className="toolbar-btn" onClick={onPlay}>
            {playing ? '⏸ 暂停' : (isLast ? '↻ 重播' : '▶ 播放')}
          </button>
          <button className="toolbar-btn" onClick={onClose} title="退出直播">✕</button>
        </div>
      </div>

      {data && cur && (
        <div className="rolling-overlay-body">
          {/* 大号开票进度 + 阶段文案 */}
          <div className="rolling-headline">
            <div className="rolling-pct">{pct}%</div>
            <div className="rolling-phase">{phase}</div>
          </div>

          {/* 领先党易主 / 过半无望 提醒 */}
          {leadChanged && !isLast && (
            <div className="rolling-alert">⚡ 领先易主！{data.party_names?.[cur.leader_party_id]} 反超</div>
          )}
          {lostQuota && !isLast && (
            <div className="rolling-alert rolling-alert-red">⛔ 过半无望 · 领先党悬念终结</div>
          )}
          {isLast && (
            <div className="rolling-alert rolling-alert-final">🏁 全部开票 · {data.final_leader_name} 锁定胜局</div>
          )}

          <div className="rolling-progress" style={{ marginTop: 6 }}>
            <div className="rolling-progress-bar">
              <div className="rolling-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="rolling-progress-label">
              已开 {cur.counted} / {cur.total} 选区 · 步 {cur.step}/{data.steps.length}
            </div>
          </div>

          {/* 竞争态势条：领先党 vs 追赶者 */}
          {partyRows.length >= 2 && (
            <div className="rolling-race" style={{ marginTop: 6 }}>
              <div className="rolling-race-party">
                <span className="coal-dot" style={{ background: data.party_colors?.[partyRows[0].pid] || '#888' }} />
                <span style={{ fontSize: 11, fontWeight: 700 }}>{data.party_names?.[partyRows[0].pid]}</span>
              </div>
              <div className="rolling-race-bar">
                <div className="rolling-race-fill" style={{
                  width: `${(partyRows[0].seats / (data.quota || 1)) * 100}%`,
                  background: data.party_colors?.[partyRows[0].pid] || '#888',
                }} />
              </div>
              <div className="rolling-race-seats" style={{ fontSize: 11, fontWeight: 700 }}>
                {partyRows[0].seats} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 9 }}>/{data.quota}</span>
              </div>
            </div>
          )}

          <div className="robust-summary-row" style={{ marginTop: 8 }}>
            <div className="robust-stat">
              <div className="robust-stat-label">当前领先</div>
              <div className="robust-stat-val" style={{ fontSize: 11 }}>
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