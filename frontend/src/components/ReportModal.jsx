import React from 'react';
import { generateReport } from '../utils/analysis.js';

export default function ReportModal({ displayResult, resultA, resultB, activeScheme, coalition, configA, configB, onClose }) {
  const sections = generateReport(displayResult, resultA, resultB, activeScheme, coalition, configA, configB);

  return (
    <div className="analysis-overlay" onClick={onClose}>
      <div className="analysis-modal analysis-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="analysis-header">
          <h3>自动解读报告</h3>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="analysis-body">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            {displayResult?.system_type} · 方案{activeScheme} · 规则引擎基于推演指标自动生成
          </div>
          {sections.map((sec, i) => (
            <div key={i} style={{ marginBottom: 14, border: '1px solid var(--border-color)', borderRadius: 8, padding: '12px 14px', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6 }}>{sec.title}</div>
              {sec.items.map((t, j) => (
                <div key={j} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 4 }}>
                  {t}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}