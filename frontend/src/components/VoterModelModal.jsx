import React, { useEffect, useState, useMemo } from 'react';
import { explainVoterModel } from '../services/api.js';

const WEIGHT_META = [
  { key: 'economic', label: '经济匹配' },
  { key: 'social', label: '社会匹配' },
  { key: 'regional', label: '区域匹配' },
  { key: 'welfare', label: '福利匹配' },
  { key: 'environment', label: '环保匹配' },
  { key: 'nationalism', label: '民族匹配' },
  { key: 'urban_rural', label: '城乡匹配' },
];

export default function VoterModelModal({ year, config, totalSeats, minSeats, parties, cities, onClose }) {
  const [cityId, setCityId] = useState(cities?.cities?.[0]?.id || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const cityOptions = useMemo(() => (cities?.cities || []), [cities]);

  const run = async (id) => {
    setLoading(true);
    setError(null);
    try {
      const simConfig = { ...config, total_seats: totalSeats, min_seats_per_city: minSeats };
      const enabled = parties.filter(p => p.enabled !== false).map(({ enabled, ...rest }) => rest);
      const d = await explainVoterModel({ year, city_id: id, config: simConfig, parties: enabled });
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cityId) run(cityId);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [cityId]);

  const weights = data?.weights || {};
  const weightMeta = WEIGHT_META.map(m => ({ ...m, weight: weights[m.key] ?? 0 }));
  const totalWeight = weightMeta.reduce((s, m) => s + m.weight, 0);
  const formula = weightMeta.map(m => `${(m.weight * 100).toFixed(0)}%×${m.label.replace('匹配', '')}`).join(' + ');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <span style={{ fontWeight: 700 }}>选民行为模型透明面板</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>拆解城市偏好 → 政党亲和度的完整计算</span>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body" style={{ padding: 12, overflowY: 'auto', maxHeight: '70vh' }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 11 }}>城市
              <select value={cityId} onChange={e => setCityId(e.target.value)} style={{ maxWidth: 220 }}>
                {cityOptions.map(c => <option key={c.id} value={c.id}>{c.province} · {c.name}</option>)}
              </select>
            </label>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              模型将全国选民在 7 个政策维度的偏好投射到城市，再按政党政策立场计算亲和度。
            </span>
          </div>

          {loading && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>计算中...</div>}
          {error && <div style={{ color: 'var(--accent-orange)', fontSize: 12 }}>错误: {error}</div>}

          {data && (
            <>
              <div className="robust-summary-row" style={{ marginTop: 4 }}>
                <div className="robust-stat">
                  <div className="robust-stat-label">城市</div>
                  <div className="robust-stat-val" style={{ fontSize: 13 }}>{data.city_name}</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">省份</div>
                  <div className="robust-stat-val" style={{ fontSize: 13 }}>{data.province}</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">估算投票率</div>
                  <div className="robust-stat-val">{(data.turnout * 100).toFixed(0)}%</div>
                </div>
                <div className="robust-stat">
                  <div className="robust-stat-label">少数民族占比</div>
                  <div className="robust-stat-val">{(data.ethnic_share * 100).toFixed(0)}%</div>
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)', margin: '12px 0 6px' }}>
                ① 城市在 7 个政策维度的位置
              </div>
              <div className="voter-dim-grid">
                {data.city_position.map(dim => (
                  <div key={dim.key} className="voter-dim-card" title={dim.description}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <b style={{ fontSize: 11 }}>{dim.label}</b>
                      <span style={{ fontSize: 11, color: dim.value >= 0 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                        {dim.value >= 0 ? '+' : ''}{dim.value.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{dim.description}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)', margin: '12px 0 6px' }}>
                ② 亲和度加权公式 <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>
                  亲和度 = {formula} + 噪声
                </span>
              </div>
              <table className="result-table voter-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>政党</th>
                    {weightMeta.map(m => (
                      <th key={m.key} title={`权重 ${Math.round(m.weight * 100)}%`}>
                        {m.label}<br /><span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{Math.round(m.weight * 100)}%</span>
                      </th>
                    ))}
                    <th>7维距离</th>
                    <th>加权亲和度</th>
                    <th>噪声</th>
                    <th>最终亲和度</th>
                    <th>得票率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.parties.map(p => (
                    <tr key={p.party_id}>
                      <td style={{ textAlign: 'left' }}>
                        <span className="city-winner-dot" style={{ background: p.color }} />{p.party_name}
                      </td>
                      {weightMeta.map(m => (
                        <td key={m.key}>{(p[m.key] * 100).toFixed(0)}</td>
                      ))}
                      <td>{p.distance.toFixed(2)}</td>
                      <td style={{ fontWeight: 600 }}>{(p.weighted_affinity * 100).toFixed(1)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.noise >= 0 ? '+' : ''}{(p.noise * 100).toFixed(1)}</td>
                      <td style={{ fontWeight: 700 }}>{(p.affinity * 100).toFixed(1)}</td>
                      <td style={{ color: p.vote_share >= 0.5 ? 'var(--accent-green)' : 'var(--accent-orange)', fontWeight: 700 }}>
                        {(p.vote_share * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
                注：各分项为「1 − 惩罚系数 × |城市位置 − 政党位置|」的匹配度（0-1）；7维距离为城市位置与政党位置间的欧氏距离；
                噪声为每次模拟独立的高斯扰动（幅度 noise_amplitude），反映现实不确定性；得票率 = 各党最终亲和度按浓缩指数（affinity_power）浓缩后归一化，与主推演同口径。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
