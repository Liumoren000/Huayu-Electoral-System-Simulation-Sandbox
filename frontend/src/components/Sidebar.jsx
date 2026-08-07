import React from 'react';

export default function Sidebar({
  config, setConfig,
  parties, setParties,
  onRun, loading,
  manualMode, setManualMode,
  manualSeats, setManualSeats,
  seatMethod, onSeatMethodChange,
  totalSeats, onTotalSeatsChange,
  minSeats, onMinSeatsChange,
}) {
  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
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
      <div className="sidebar-section">
        <div className="section-title"><span className="dot" />选举制度配置</div>
        <div className="config-panel config-a">
          <div className="config-label">制度参数</div>
          <div className="form-row">
            <label>制度类型</label>
            <select
              value={config.system_type}
              onChange={e => updateConfig('system_type', e.target.value)}
            >
              <option value="FPTP">小选区制 (FPTP)</option>
              <option value="PR">比例代表制 (PR)</option>
            </select>
          </div>

          {config.system_type === 'PR' && (
            <>
              <div className="form-row">
                <label>分配算法</label>
                <select
                  value={config.allocation_method}
                  onChange={e => updateConfig('allocation_method', e.target.value)}
                >
                  <option value="d_hondt">D'Hondt 汉狄法</option>
                  <option value="sainte_lague">Sainte-Laguë 圣拉格法</option>
                </select>
              </div>
              <div className="slider-row">
                <label>
                  <span>得票门槛</span>
                  <span>{(config.threshold * 100).toFixed(0)}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.15"
                  step="0.01"
                  value={config.threshold}
                  onChange={e => updateConfig('threshold', parseFloat(e.target.value))}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="sidebar-section uh-section">
        <div className="section-title">
          <span className="dot" style={{ background: 'var(--accent-purple)' }} />上议院
          <label className="uh-toggle">
            <input
              type="checkbox"
              checked={config.upper_house_enabled || false}
              onChange={e => updateConfig('upper_house_enabled', e.target.checked)}
            />
            启用
          </label>
        </div>
        {config.upper_house_enabled && (
          <div className="uh-controls">
            <div className="uh-row">
              <label>席位</label>
              <input
                type="number"
                min="32"
                max="500"
                step="32"
                value={config.upper_house_seats || 96}
                onChange={e => updateConfig('upper_house_seats', parseInt(e.target.value) || 96)}
              />
            </div>
            <div className="uh-row">
              <label>方式</label>
              <select
                value={config.upper_house_method || 'equal'}
                onChange={e => updateConfig('upper_house_method', e.target.value)}
              >
                <option value="equal">均等</option>
                <option value="proportional">比例</option>
                <option value="mixed">混合</option>
              </select>
            </div>
            {config.upper_house_method === 'mixed' && (
              <div className="uh-row">
                <label>比例权重</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.upper_house_mixed_ratio || 0.5}
                  onChange={e => updateConfig('upper_house_mixed_ratio', parseFloat(e.target.value))}
                />
                <span className="uh-ratio">{((config.upper_house_mixed_ratio || 0.5) * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-section party-spectrum-section">
        <div className="section-title">
          <span className="dot" style={{ background: 'var(--accent-purple)' }} />政党光谱
        </div>
        <div className="party-spectrum-list">
        {parties.map(party => (
          <PartyCard
            key={party.id}
            party={party}
            onUpdate={updateParty}
            onToggle={toggleParty}
          />
        ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-title">
          <span className="dot" style={{ background: 'var(--accent-orange)' }} />省份席位分配
        </div>
        <div className="form-row">
          <label>总席位数</label>
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
            <option value="d_hondt">D'Hondt 法（人口）</option>
            <option value="sainte_lague">Sainte-Laguë 法（人口）</option>
          </select>
        </div>
        <div className="form-row">
          <label>保底席位</label>
          <div className="slider-row">
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={minSeats || 0}
              onChange={e => onMinSeatsChange?.(parseInt(e.target.value))}
            />
            <span className="slider-value">{minSeats || 0}席</span>
          </div>
        </div>
        <div style={{ fontSize: 9, color: 'var(--accent-green)', marginTop: 4 }}>
          ● 每省至少 {minSeats || 0} 席，剩余席位按分配基准分配
        </div>
      </div>



      <div className="sidebar-section">
        <div className="section-title">
          <span className="dot" style={{ background: 'var(--accent-green)' }} />手动分配
        </div>
        <button
          className={`mode-btn ${manualMode ? 'active' : ''}`}
          onClick={() => setManualMode(!manualMode)}
        >
          {manualMode ? '退出手动模式' : '进入手动分配模式'}
        </button>
        {manualMode && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            点击地图省份，手动分配席位给各政党
          </div>
        )}
        {manualSeats && Object.keys(manualSeats).length > 0 && (
          <button
            className="mode-btn"
            style={{ marginTop: 6, background: 'var(--bg-primary)' }}
            onClick={() => setManualSeats({})}
          >
            清空手动分配
          </button>
        )}
      </div>

      <div className="sidebar-section">
        <button className="run-btn" onClick={onRun} disabled={loading}>
          {loading ? '推演中...' : '运行推演'}
        </button>
      </div>
    </div>
  );
}

const DIMENSIONS = [
  { key: 'economic', label: '经济', color: '#4fc3d7' },
  { key: 'social', label: '社会', color: '#ff8a65' },
  { key: 'regional', label: '区域', color: '#81c784' },
  { key: 'welfare', label: '福利', color: '#ab47bc' },
  { key: 'environment', label: '环保', color: '#0d904f' },
  { key: 'nationalism', label: '民族', color: '#f57c00' },
  { key: 'urban_rural', label: '城乡', color: '#1a73e8' },
];

function PartyCard({ party, onUpdate, onToggle }) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={`party-card ${!party.enabled ? 'disabled' : ''} ${expanded ? 'expanded' : ''}`}>
      <div className="party-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="party-card-info">
          <div className="party-card-swatch" style={{ background: party.color, opacity: party.enabled ? 1 : 0.3 }} />
          <span className="party-card-name">{party.name}</span>
        </div>
        <div className="party-card-mini-spectrum">
          {DIMENSIONS.map(dim => (
            <div key={dim.key} className="mini-spectrum-bar">
              <div
                className="mini-spectrum-fill"
                style={{
                  width: `${Math.abs(party[dim.key] || 0) * 50}%`,
                  background: dim.color,
                  marginLeft: (party[dim.key] || 0) >= 0 ? '50%' : `${50 - Math.abs(party[dim.key] || 0) * 50}%`,
                }}
              />
            </div>
          ))}
        </div>
        <button
          className={`party-toggle ${party.enabled ? 'active' : ''}`}
          onClick={e => { e.stopPropagation(); onToggle(party.id); }}
          title={party.enabled ? '点击禁用' : '点击启用'}
        >
          {party.enabled ? '●' : '○'}
        </button>
      </div>

      {expanded && (
        <div className="party-card-body">
          <div className="party-card-name-row">
            <input
              type="text"
              className="party-card-name-input"
              value={party.name}
              onChange={e => onUpdate(party.id, 'name', e.target.value)}
              placeholder="政党名称"
            />
          </div>
          <div className="party-card-dims">
            {DIMENSIONS.map(dim => (
              <div key={dim.key} className="party-dim-row">
                <span className="party-dim-label" style={{ color: dim.color }}>{dim.label}</span>
                <div className="party-dim-slider">
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.1"
                    value={party[dim.key] || 0}
                    onChange={e => onUpdate(party.id, dim.key, parseFloat(e.target.value))}
                  />
                </div>
                <span className="party-dim-val" style={{ color: (party[dim.key] || 0) >= 0 ? dim.color : '#ff8a65' }}>
                  {(party[dim.key] || 0) >= 0 ? '+' : ''}{(party[dim.key] || 0).toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
