import React, { useState } from 'react';

const PARTY_DIMS = [
  { key: 'economic_position', label: '经', title: '经济立场：左(-1) ↔ 右(+1)' },
  { key: 'social_position', label: '社', title: '社会立场：自由(-1) ↔ 保守(+1)' },
  { key: 'regional_position', label: '区', title: '区域立场：全国统一(-1) ↔ 地方自治(+1)' },
  { key: 'welfare_position', label: '福', title: '福利立场：削减福利(-1) ↔ 高福利(+1)' },
  { key: 'environment_position', label: '环', title: '环保立场：增长优先(-1) ↔ 环保优先(+1)' },
  { key: 'nationalism_position', label: '民', title: '民族立场：世界主义(-1) ↔ 民族主义(+1)' },
  { key: 'urban_rural_position', label: '城', title: '城乡立场：偏向城市(-1) ↔ 偏向乡村(+1)' },
];

export default function Sidebar({
  config, setConfig,
  configB, setConfigB,
  parties, setParties,
  onRun, loading,
  manualMode, setManualMode,
  manualSeats, setManualSeats,
  seatMethod, onSeatMethodChange,
  totalSeats, onTotalSeatsChange,
  minSeats, onMinSeatsChange,
  activeScheme, onActivateScheme,
}) {
  const [expandedParty, setExpandedParty] = useState(null);
  const [openSchemes, setOpenSchemes] = useState({ A: true, B: false });
  const [realismOpen, setRealismOpen] = useState(true);

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateConfigB = (key, value) => {
    setConfigB(prev => ({ ...prev, [key]: value }));
  };

  const setBothConfigs = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setConfigB(prev => ({ ...prev, [key]: value }));
  };

  const updateParty = (partyId, key, value) => {
    setParties(prev => prev.map(p =>
      p.id === partyId ? { ...p, [key]: key === 'name' ? value : parseFloat(value) } : p
    ));
  };

  const toggleParty = (partyId) => {
    setParties(prev => prev.map(p =>
      p.id === partyId ? { ...p, enabled: !p.enabled } : p
    ));
  };

  return (
    <div className="sidebar">
      {/* 选举制度配置 */}
      <div className="sidebar-section">
        <div className="section-title"><span className="dot" />选举方案 (A / B)</div>
        <SchemePanel
          scheme={config}
          onChange={updateConfig}
          className="config-a"
          label="A"
          active={activeScheme === 'A'}
          onActivate={() => onActivateScheme?.('A')}
          expanded={!!openSchemes.A}
          onToggle={() => setOpenSchemes(prev => ({ ...prev, A: !prev.A }))}
        />
        <SchemePanel
          scheme={configB}
          onChange={updateConfigB}
          className="config-b"
          label="B"
          active={activeScheme === 'B'}
          onActivate={() => onActivateScheme?.('B')}
          expanded={!!openSchemes.B}
          onToggle={() => setOpenSchemes(prev => ({ ...prev, B: !prev.B }))}
        />
      </div>

      {/* 城乡投票差异 */}
      <div className="sidebar-section">
        <div className="section-title">
          <span className="dot" style={{ background: '#81c784' }} />城乡投票差异
        </div>
        <div className="slider-row">
          <label>
            <span>差异权重</span>
            <span>{((config.urban_rural_weight ?? 1.0) * 100).toFixed(0)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={config.urban_rural_weight}
            onChange={e => updateConfig('urban_rural_weight', parseFloat(e.target.value))}
          />
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
          0% = 城乡无差异 | 100% = 默认 | 200% = 差异加倍
        </div>
      </div>

      {/* 真实感增强（全局模块，作用于方案 A/B） */}
      <div className={`sidebar-section realism-section ${realismOpen ? '' : 'collapsed'}`}>
        <div
          className="section-title section-title-collapsible"
          onClick={() => setRealismOpen(prev => !prev)}
          title={realismOpen ? '收起' : '展开'}
        >
          <span className="dot" style={{ background: '#ce93d8' }} />真实感增强
          <span className="scheme-chevron">{realismOpen ? '▾' : '▸'}</span>
        </div>
        {realismOpen && (
        <div className="realism-body">
        <div className="realism-check">
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!config.voter_stratification}
              onChange={e => setBothConfigs('voter_stratification', e.target.checked)}
            />
            <span>城市内选民分层（年龄/教育/产业结构）</span>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!config.calibration}
              onChange={e => setBothConfigs('calibration', e.target.checked)}
            />
            <span>历史倾向校准（基准政党锚点）</span>
          </label>
        </div>
        <div className="slider-row">
          <label>
            <span>政党忠诚度（铁票党）</span>
            <span>{Math.round((config.party_loyalty ?? 0) * 100)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={config.party_loyalty ?? 0}
            onChange={e => setBothConfigs('party_loyalty', parseFloat(e.target.value))}
          />
        </div>
        <div className="slider-row">
          <label>
            <span>摇摆选民比例</span>
            <span>{Math.round((config.swing_voter_pct ?? 0) * 100)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="0.6"
            step="0.01"
            value={config.swing_voter_pct ?? 0}
            onChange={e => setBothConfigs('swing_voter_pct', parseFloat(e.target.value))}
          />
        </div>
        <div className="slider-row">
          <label>
            <span>竞争-投票率联动</span>
            <span>{Math.round((config.abstention_sensitivity ?? 0) * 100)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.abstention_sensitivity ?? 0}
            onChange={e => setBothConfigs('abstention_sensitivity', parseFloat(e.target.value))}
          />
        </div>
        <div className="slider-row">
          <label>
            <span>选区不均衡（小城超代表）</span>
            <span>{Math.round((config.malapportionment ?? 0) * 100)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.malapportionment ?? 0}
            onChange={e => setBothConfigs('malapportionment', parseFloat(e.target.value))}
          />
        </div>
        </div>
        )}
      </div>

      {/* 席位分配 */}
      <div className="sidebar-section">
        <div className="section-title">
          <span className="dot" style={{ background: 'var(--accent-orange)' }} />席位分配
        </div>
        <div className="form-row">
          <label>总席位</label>
          <input
            type="number"
            min="50"
            max="2000"
            step="10"
            value={totalSeats || 450}
            onChange={e => onTotalSeatsChange?.(parseInt(e.target.value) || 450)}
          />
        </div>
        <div className="form-row">
          <label>分配基准</label>
          <select
            value={seatMethod || 'population'}
            onChange={e => onSeatMethodChange?.(e.target.value)}
          >
            <option value="population">按人口比例</option>
            <option value="equal">各省均等</option>
            <option value="d_hondt">D'Hondt 法</option>
            <option value="sainte_lague">Sainte-Laguë 法</option>
          </select>
        </div>
        <div className="slider-row">
          <label>
            <span>市级保底</span>
            <span>{minSeats || 0}席/市</span>
          </label>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={minSeats || 0}
            onChange={e => onMinSeatsChange?.(parseInt(e.target.value))}
          />
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
          每市至少分配 {minSeats || 0} 席，其余席位按所选基准分配
        </div>
      </div>

      {/* 政党光谱 */}
      <div className="sidebar-section party-spectrum-section">
        <div className="section-title">
          <span className="dot" style={{ background: 'var(--accent-green)' }} />政党光谱
        </div>
        <div className="party-spectrum-list">
        {parties.map(party => (
          <div
            key={party.id}
            className={`party-card ${!party.enabled ? 'disabled' : ''} ${expandedParty === party.id ? 'expanded' : ''}`}
          >
            <div
              className="party-card-header"
              onClick={() => setExpandedParty(expandedParty === party.id ? null : party.id)}
              title={expandedParty === party.id ? '收起编辑' : '展开 7 维立场编辑'}
            >
              <span className="party-card-info">
                <span className="party-card-swatch" style={{ background: party.color }} />
                <span className="party-card-name">{party.name}</span>
              </span>
              <span className="party-card-name" style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                经{party.economic_position?.toFixed(1)} · 社{party.social_position?.toFixed(1)}
              </span>
              <button
                className={`party-toggle ${party.enabled ? 'active' : ''}`}
                onClick={e => { e.stopPropagation(); toggleParty(party.id); }}
                title={party.enabled ? '点击禁用' : '点击启用'}
              >
                {party.enabled ? '●' : '○'}
              </button>
            </div>
            {expandedParty === party.id && (
              <div className="party-card-body">
                <div className="party-card-name-row">
                  <input
                    type="text"
                    className="party-card-name-input"
                    value={party.name}
                    onChange={e => updateParty(party.id, 'name', e.target.value)}
                    placeholder="政党名称"
                  />
                </div>
                <div className="party-card-dims">
                  {PARTY_DIMS.map(dim => (
                    <div className="party-dim-row" key={dim.key}>
                      <span className="party-dim-label" title={dim.title}>{dim.label}</span>
                      <div className="party-dim-slider">
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.1"
                          value={party[dim.key] ?? 0}
                          onChange={e => updateParty(party.id, dim.key, e.target.value)}
                          title={dim.title}
                        />
                      </div>
                      <span className="party-dim-val">{(party[dim.key] ?? 0).toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        </div>
      </div>

      {/* 手动分配 */}
      <div className="sidebar-section">
        <button
          className={`mode-btn ${manualMode ? 'active' : ''}`}
          onClick={() => setManualMode(!manualMode)}
        >
          {manualMode ? '退出手动模式' : '手动分配席位'}
        </button>
      </div>

      {/* 运行按钮 */}
      <div className="sidebar-section">
        <button className="run-btn" onClick={onRun} disabled={loading}>
          {loading ? '推演中...' : '运行推演'}
        </button>
      </div>
    </div>
  );
}

function SchemePanel({ scheme, onChange, className, label, active, onActivate, expanded, onToggle }) {
  return (
    <div className={`config-panel ${className} ${active ? 'active-scheme' : ''}`}>
      <div
        className="scheme-header"
        onClick={() => {
          onActivate?.();
          onToggle();
        }}
        title={expanded ? '收起配置' : '展开配置'}
      >
        <span className="scheme-name">
          方案 {label}
          {active && <span className="scheme-active-tag">当前</span>}
        </span>
        <label className="uh-toggle" onClick={e => { e.stopPropagation(); onActivate?.(); }} title="启用上议院">
          <input
            type="checkbox"
            checked={scheme.upper_house_enabled || false}
            onChange={e => onChange('upper_house_enabled', e.target.checked)}
          />
          上议院
        </label>
        <span className="scheme-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="scheme-body">
          <div className="form-row">
            <label>制度类型</label>
            <select
              value={scheme.system_type || 'PR'}
              onChange={e => onChange('system_type', e.target.value)}
            >
              <option value="FPTP">小选区制 (FPTP)</option>
              <option value="PR">比例代表制 (PR)</option>
              <option value="RUNOFF">两轮投票制</option>
              <option value="MMP">混合成员比例代表制 (MMP)</option>
              <option value="PARALLEL">并立制 (并行投票)</option>
              <option value="IRV">即时复选制 (IRV)</option>
              <option value="STV">单一可转移投票 (STV)</option>
              <option value="APPROVAL">同意投票</option>
              <option value="BORDA">波达计分制</option>
            </select>
          </div>
          {(scheme.system_type === 'MMP' || scheme.system_type === 'PARALLEL') && (
            <div className="slider-row">
              <label>
                <span>名单席占比</span>
                <span>{Math.round((scheme.mixed_ratio ?? 0.4) * 100)}%</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={scheme.mixed_ratio ?? 0.4}
                onChange={e => onChange('mixed_ratio', parseFloat(e.target.value))}
              />
            </div>
          )}
          {scheme.system_type === 'RUNOFF' && (
            <div className="slider-row">
              <label>
                <span>第一轮过半线</span>
                <span>{Math.round((scheme.runoff_threshold ?? 0.5) * 100)}%</span>
              </label>
              <input
                type="range"
                min="0.3"
                max="0.6"
                step="0.01"
                value={scheme.runoff_threshold ?? 0.5}
                onChange={e => onChange('runoff_threshold', parseFloat(e.target.value))}
              />
            </div>
          )}
          {(scheme.system_type === 'PR' || scheme.system_type === 'MMP' || scheme.system_type === 'PARALLEL' || !scheme.system_type) && (
            <>
              <div className="form-row">
                <label>分配算法</label>
                <select
                  value={scheme.allocation_method || 'd_hondt'}
                  onChange={e => onChange('allocation_method', e.target.value)}
                >
                  <option value="d_hondt">D'Hondt 汉狄法</option>
                  <option value="sainte_lague">Sainte-Laguë 圣拉格法</option>
                  <option value="largest_remainder">最大余数法 (Hare)</option>
                </select>
              </div>
              <div className="slider-row">
                <label>
                  <span>得票门槛</span>
                  <span>{((scheme.threshold ?? 0.03) * 100).toFixed(0)}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.15"
                  step="0.01"
                  value={scheme.threshold ?? 0.03}
                  onChange={e => onChange('threshold', parseFloat(e.target.value))}
                />
              </div>
            </>
          )}
          <div className="slider-row">
            <label>
              <span>选民噪声幅度</span>
              <span>{((scheme.noise_amplitude ?? 0.03) * 100).toFixed(1)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="0.3"
              step="0.005"
              value={scheme.noise_amplitude ?? 0.03}
              onChange={e => onChange('noise_amplitude', parseFloat(e.target.value))}
            />
          </div>
          {(['IRV', 'STV', 'APPROVAL', 'BORDA'].includes(scheme.system_type)) && (
            <div className="slider-row">
              <label>
                <span>抽样选民数(排名票)</span>
                <span>{scheme.voter_samples ?? 80}</span>
              </label>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={scheme.voter_samples ?? 80}
                onChange={e => onChange('voter_samples', parseInt(e.target.value))}
              />
            </div>
          )}
          <div className="slider-row">
            <label>
              <span>城乡差异权重</span>
              <span>{((scheme.urban_rural_weight ?? 1.0) * 100).toFixed(0)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={scheme.urban_rural_weight ?? 1.0}
              onChange={e => onChange('urban_rural_weight', parseFloat(e.target.value))}
            />
          </div>
          {scheme.upper_house_enabled && (
            <div className="uh-controls">
              <div className="uh-row">
                <label>席位</label>
                <input
                  type="number"
                  min="32"
                  max="500"
                  step="32"
                  value={scheme.upper_house_seats || 96}
                  onChange={e => onChange('upper_house_seats', parseInt(e.target.value) || 96)}
                />
              </div>
              <div className="uh-row">
                <label>方式</label>
                <select
                  value={scheme.upper_house_method || 'equal'}
                  onChange={e => onChange('upper_house_method', e.target.value)}
                >
                  <option value="equal">均等</option>
                  <option value="proportional">比例</option>
                  <option value="mixed">混合</option>
                </select>
              </div>
              {scheme.upper_house_method === 'mixed' && (
                <div className="uh-row">
                  <label>比例权重</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={scheme.upper_house_mixed_ratio || 0.5}
                    onChange={e => onChange('upper_house_mixed_ratio', parseFloat(e.target.value))}
                  />
                  <span className="uh-ratio">{((scheme.upper_house_mixed_ratio || 0.5) * 100).toFixed(0)}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
