import React, { useMemo, useState } from 'react';
import { runSimulation } from '../services/api.js';

export const SCRIPT_LIBRARY = [
  {
    id: 'covid',
    name: '疫情危机',
    description: '公共卫生危机席卷全国，医疗与社会保障成为压倒性议题，民众参与意愿上升。',
    effects: ['投票率 +8%（动员）', '选民更关注社会保障/福利', '市场自由偏好减弱', '社会不确定性上升'],
    config: { turnout_shift: 0.08, noise_amplitude: 0.06, dim_tilt: { welfare: 0.3, economic: -0.2, social: 0.1 } },
  },
  {
    id: 'recession',
    name: '经济衰退',
    description: '增长停滞、失业上升，选民转向国家干预与再分配诉求，对沿海商业利益失望。',
    effects: ['投票率 -5%', '转向国家干预/再分配', '沿海商业联盟受损', '不确定性上升'],
    config: { turnout_shift: -0.05, noise_amplitude: 0.05, dim_tilt: { economic: -0.3, welfare: 0.2 } },
  },
  {
    id: 'security',
    name: '安全危机',
    description: '边境摩擦与外部威胁升级，"安全"与"团结"议题压过经济议题。',
    effects: ['投票率 +3%', '民族主义情绪上升', '转向全国统一/地方自治权重下降', '社会分歧加大'],
    config: { turnout_shift: 0.03, noise_amplitude: 0.06, dim_tilt: { nationalism: 0.3, regional: -0.2, social: -0.1 } },
  },
  {
    id: 'environment',
    name: '环境灾害',
    description: '极端天气与生态灾难频发，环保议题跃居首位。',
    effects: ['投票率 +2%', '环保偏好大幅上升', '工业发展优先派受挫'],
    config: { turnout_shift: 0.02, dim_tilt: { environment: 0.4, economic: -0.1 } },
  },
  {
    id: 'energy',
    name: '能源危机',
    description: '能源价格飙升，生活成本高企，选民要求国家对能源与物价强力干预。',
    effects: ['投票率 -3%', '转向国家干预', '城市利益受损、农业利益上升'],
    config: { turnout_shift: -0.03, noise_amplitude: 0.05, dim_tilt: { economic: -0.3, urban_rural: -0.2 } },
  },
  {
    id: 'trust',
    name: '社会动荡与信任危机',
    description: '政治极化与信任崩塌，选民高度分裂，小党与极端立场政党崛起。',
    effects: ['投票率 -8%', '不确定性大幅上升', '进入门槛提高（碎片化）', '社会分歧最大化'],
    config: { turnout_shift: -0.08, noise_amplitude: 0.10, threshold: 0.06, dim_tilt: { social: -0.2, regional: 0.1 } },
  },
  {
    id: 'aging',
    name: '人口老龄化危机',
    description: '养老与社保压力加剧，老龄选民成为决定性群体。',
    effects: ['投票率 -1%', '福利/再分配需求上升', '社会偏好转向传统'],
    config: { turnout_shift: -0.01, dim_tilt: { welfare: 0.3, social: -0.2 } },
  },
  {
    id: 'boom',
    name: '技术革命与经济繁荣',
    description: '科技与产业升级带来繁荣，选民拥抱市场与创新，城市中产成为主流。',
    effects: ['投票率 +5%', '市场自由偏好上升', '环保与新市民议题受益', '不确定性下降'],
    config: { turnout_shift: 0.05, noise_amplitude: 0.02, dim_tilt: { economic: 0.3, environment: 0.2, social: 0.1 } },
  },
];

const DIM_LABELS = {
  economic: '经济', social: '社会', regional: '区域', welfare: '福利',
  environment: '环保', nationalism: '民族', urban_rural: '城乡',
};

function computeFlips(a, b) {
  let flips = 0, shared = 0;
  const bWin = {};
  (b?.city_results || []).forEach(cr => { bWin[cr.city_id] = cr.winner_party_id; });
  for (const cr of a?.city_results || []) {
    if (!(cr.city_id in bWin)) continue;
    shared++;
    if (bWin[cr.city_id] !== cr.winner_party_id) flips++;
  }
  return { flips, shared };
}

export default function ScriptModal({ year, config, totalSeats, minSeats, parties, baseline, addedNames, onAdd, onClose }) {
  const [scriptId, setScriptId] = useState(SCRIPT_LIBRARY[0].id);
  const script = SCRIPT_LIBRARY.find(s => s.id === scriptId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [coalition, setCoalition] = useState(null);
  const alreadyAdded = (addedNames || []).includes(script.name);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats, ...script.config };
      const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const res = await runSimulation({ year, config_a: simConfig, config_b: simConfig, parties: enabled });
      setScenario(res.result_a);
      setCoalition(res.coalition_a);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const deltas = useMemo(() => {
    if (!scenario || !baseline) return [];
    const mapA = {};
    (baseline.party_results || []).forEach(p => { mapA[p.party_id] = p; });
    const mapB = {};
    (scenario.party_results || []).forEach(p => { mapB[p.party_id] = p; });
    const ids = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
    return [...ids].map(id => {
      const a = mapA[id], b = mapB[id];
      return {
        id, name: a?.party_name || b?.party_name || id,
        color: a?.color || b?.color || '#888',
        a: a?.seats ?? 0, b: b?.seats ?? 0,
        diff: (b?.seats ?? 0) - (a?.seats ?? 0),
      };
    }).sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
  }, [scenario, baseline]);

  const flips = useMemo(() => (scenario && baseline ? computeFlips(scenario, baseline) : null), [scenario, baseline]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <span style={{ fontWeight: 700 }}>选举剧本</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>宏观情景 → 投票率/选民偏好扰动 → 对比基准</span>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body" style={{ padding: 12, display: 'flex', gap: 14 }}>
          <div style={{ width: 330, flexShrink: 0, maxHeight: '60vh', overflowY: 'auto' }}>
            {SCRIPT_LIBRARY.map(s => (
              <div
                key={s.id}
                onClick={() => { setScriptId(s.id); setScenario(null); }}
                style={{
                  padding: '8px 10px', marginBottom: 6, cursor: 'pointer', borderRadius: 6,
                  border: `1px solid ${s.id === scriptId ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                  background: s.id === scriptId ? 'rgba(79,195,247,0.08)' : 'var(--bg-secondary)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{s.description}</div>
                {s.id === scriptId && (
                  <div style={{ fontSize: 10, color: 'var(--accent-green)', marginTop: 4, lineHeight: 1.5 }}>
                    {s.effects.map(e => <div key={e}>· {e}</div>)}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              当前剧本：<b style={{ color: 'var(--accent-blue)' }}>{script.name}</b>
              {script.config.dim_tilt && Object.keys(script.config.dim_tilt).length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  偏好偏移：{Object.entries(script.config.dim_tilt).map(([d, v]) => `${DIM_LABELS[d] || d}${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join('，')}
                </span>
              )}
            </div>
            <button className="run-btn" onClick={run} disabled={loading}>
              {loading ? '推演中...' : `运行「${script.name}」剧本`}
            </button>
            {error && <div style={{ color: 'var(--accent-orange)', fontSize: 11, marginTop: 6 }}>{error}</div>}

            {!scenario ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 24, textAlign: 'center' }}>
                选择左侧剧本后点击运行
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, margin: '12px 0 8px' }}>
                  与基准相比：翻盘城市 <b style={{ color: 'var(--accent-orange)' }}>{flips?.flips ?? 0}</b> / {flips?.shared ?? 0} · 总投票
                  <b style={{ color: 'var(--accent-blue)' }}> {((scenario.total_votes / (baseline?.total_votes || 1)) * 100).toFixed(0)}%</b>
                  {coalition?.has_majority ? (
                    <span style={{ color: 'var(--accent-green)' }}> · 单一多数: {coalition.majority_party_name}</span>
                  ) : coalition?.recommended_coalition ? (
                    <span style={{ color: 'var(--accent-green)' }}> · 推荐联盟: {coalition.recommended_coalition.party_names.join('+')}（{coalition.recommended_coalition.total_seats}席）</span>
                  ) : null}
                </div>
                <table className="result-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>政党</th>
                      <th>基准席</th>
                      <th>剧本席</th>
                      <th>差值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deltas.map(r => (
                      <tr key={r.id}>
                        <td style={{ textAlign: 'left' }}>
                          <span className="city-winner-dot" style={{ background: r.color }} />
                          {r.name}
                        </td>
                        <td>{r.a}</td>
                        <td>{r.b}</td>
                        <td style={{ color: r.diff > 0 ? 'var(--accent-green)' : r.diff < 0 ? 'var(--accent-orange)' : 'var(--text-muted)', fontWeight: r.diff !== 0 ? 700 : 400 }}>
                          {r.diff > 0 ? `+${r.diff}` : r.diff}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>关键指标（基准 → 剧本）</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11 }}>
                    {(() => {
                      const t = scenario.total_seats || 450;
                      const baseMaj = (baseline?.party_results || []).some(p => p.seats > t / 2);
                      const scnMaj = (scenario.party_results || []).some(p => p.seats > t / 2);
                      const maxP = rs => rs.length ? Math.max(...rs.map(p => p.seats)) : 0;
                      const baseTop = maxP(baseline?.party_results || []);
                      const scnTop = maxP(scenario.party_results || []);
                      const rows = [
                        ['Gallagher', (baseline?.gallagher_index ?? 0).toFixed(3), (scenario.gallagher_index ?? 0).toFixed(3)],
                        ['有效政党数(席)', (baseline?.effective_parties_seats ?? 0).toFixed(1), (scenario.effective_parties_seats ?? 0).toFixed(1)],
                        ['过半政党', baseMaj ? '有' : '无', scnMaj ? '有' : '无'],
                        ['最大党席位', baseTop, scnTop],
                        ['总投票', (baseline?.total_votes ?? 1).toLocaleString(), scenario.total_votes.toLocaleString()],
                      ];
                      return rows.map(([label, a, b]) => (
                        <div key={label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 5, padding: '5px 8px' }}>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{a}</span><span style={{ color: 'var(--accent-orange)' }}>{b}</span>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
                <button className="run-btn" onClick={() => onAdd(script.name, script.config, scenario, coalition)} style={{ marginTop: 12 }} disabled={alreadyAdded}>
                  {alreadyAdded ? '已在推演台' : '加入推演台并切换 →'}
                </button>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  可继续运行其他剧本累积到推演台，在顶部切换条逐本对照。
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
