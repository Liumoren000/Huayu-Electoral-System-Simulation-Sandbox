import React, { useMemo } from 'react';

const DIM_LABELS = {
  economic: '经济', social: '社会', regional: '区域', welfare: '福利',
  environment: '环保', nationalism: '民族', urban_rural: '城乡',
};

function fmtDimTilt(tilt) {
  if (!tilt || Object.keys(tilt).length === 0) return '无（保持当前政见设置）';
  return Object.entries(tilt).map(([d, v]) => `${DIM_LABELS[d] || d}${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join('，');
}

export default function EraModal({ eras, currentYear, onApply, onClose }) {
  const eraList = eras || [];
  const current = eraList.find(e => e.year === currentYear);
  const [selectedYear, setSelectedYear] = React.useState(current?.year ?? eraList[0]?.year ?? 2024);
  const era = eraList.find(e => e.year === selectedYear);

  const summary = useMemo(() => {
    if (!era) return null;
    const c = era.city || {};
    return [
      { label: '人均GDP', value: `约当前基准的 ${(c.gdp_factor * 100).toFixed(0)}%` },
      { label: '总人口', value: `约当前基准的 ${(c.population_factor * 100).toFixed(0)}%` },
      { label: '城市化率偏移', value: `${c.urbanization_delta >= 0 ? '+' : ''}${(c.urbanization_delta * 100).toFixed(0)} 个百分点` },
      { label: '老龄化偏移', value: `${c.aging_delta >= 0 ? '+' : ''}${(c.aging_delta * 100).toFixed(0)} 个百分点` },
      { label: '教育指数偏移', value: `${c.education_delta >= 0 ? '+' : ''}${(c.education_delta * 100).toFixed(0)} 个百分点` },
    ];
  }, [era]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <span style={{ fontWeight: 700 }}>研究年代</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>建国至今的重大变动年代 → 城市数据参数 + 选民政见默认值</span>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body" style={{ padding: 12, display: 'flex', gap: 14 }}>
          <div style={{ width: 280, flexShrink: 0, maxHeight: '62vh', overflowY: 'auto' }}>
            {eraList.map(e => (
              <div
                key={e.year}
                onClick={() => setSelectedYear(e.year)}
                style={{
                  padding: '8px 10px', marginBottom: 6, cursor: 'pointer', borderRadius: 6,
                  border: `1px solid ${e.year === selectedYear ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                  background: e.year === selectedYear ? 'rgba(79,195,247,0.08)' : 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{e.year}</span>
                  <span style={{ fontSize: 10, color: e.year === currentYear ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {e.year === currentYear ? '当前' : e.period}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 2 }}>{e.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{e.summary}</div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0, maxHeight: '62vh', overflowY: 'auto' }}>
            {era ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{era.year}</span>
                    <span style={{ fontSize: 13, marginLeft: 8 }}>{era.name}</span>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{era.period}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
                  {era.description}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 6px' }}>城市数据参数（相对 2020 基准）</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11, marginBottom: 12 }}>
                  {summary.map(s => (
                    <div key={s.label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 5, padding: '5px 8px' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{s.label}</div>
                      <div style={{ fontWeight: 600 }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 6px' }}>选民政见默认值（应用后写入方案）</div>
                <div style={{ fontSize: 11, lineHeight: 1.7, marginBottom: 10 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>偏好偏移 dim_tilt：</span>
                    <span style={{ color: 'var(--accent-blue)' }}>{fmtDimTilt(era.config?.dim_tilt)}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>投票率偏移：</span>
                    <span style={{ color: 'var(--accent-blue)' }}>{(era.config?.turnout_shift ?? 0) >= 0 ? '+' : ''}{((era.config?.turnout_shift ?? 0) * 100).toFixed(0)}%</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 16 }}>选民噪声：</span>
                    <span style={{ color: 'var(--accent-blue)' }}>{(era.config?.noise_amplitude ?? 0).toFixed(2)}</span>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 6px' }}>与当前年代的差异一览</div>
                <div style={{ fontSize: 10, color: 'var(--accent-green)', lineHeight: 1.6, marginBottom: 12 }}>
                  {(era.param_diffs || []).map(d => <div key={d}>· {d}</div>)}
                </div>

                <button className="run-btn" onClick={() => onApply(era.year, era.config || {})} style={{ width: '100%' }}>
                  应用「{era.year} {era.name}」并关闭
                </button>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                  应用后：年份改为 {era.year}，城市数据与选民政见默认值同步更新到方案 A/B；若为当前年代则仅刷新参数说明。
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 30 }}>请选择左侧年代</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
