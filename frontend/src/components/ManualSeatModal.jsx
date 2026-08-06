import React, { useState, useEffect } from 'react';

export default function ManualSeatModal({ province, parties, currentSeats, onSave, onClose }) {
  const [seats, setSeats] = useState(() => {
    const initial = {};
    parties.forEach(p => { initial[p.id] = currentSeats[p.id] || 0; });
    return initial;
  });

  const total = Object.values(seats).reduce((sum, v) => sum + (parseInt(v) || 0), 0);

  const updateSeat = (partyId, value) => {
    setSeats(prev => ({
      ...prev,
      [partyId]: Math.max(0, parseInt(value) || 0),
    }));
  };

  const handleSave = () => {
    onSave(seats);
  };

  return (
    <div className="manual-overlay" onClick={onClose}>
      <div className="manual-modal" onClick={e => e.stopPropagation()}>
        <div className="manual-header">
          <div>
            <h3>{province}</h3>
            <div className="manual-total">
              总席位: <strong style={{ color: total > 0 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>{total}</strong>
            </div>
          </div>
          <button className="province-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="manual-body">
          {parties.map(party => (
            <div key={party.id} className="manual-seat-row">
              <div className="manual-party-info">
                <span className="city-winner-dot" style={{ background: party.color }} />
                <span className="manual-party-name">{party.name}</span>
              </div>
              <div className="manual-seat-input">
                <button
                  className="seat-btn"
                  onClick={() => updateSeat(party.id, (seats[party.id] || 0) - 1)}
                >−</button>
                <input
                  type="number"
                  min="0"
                  value={seats[party.id] || 0}
                  onChange={e => updateSeat(party.id, e.target.value)}
                />
                <button
                  className="seat-btn"
                  onClick={() => updateSeat(party.id, (seats[party.id] || 0) + 1)}
                >+</button>
              </div>
            </div>
          ))}
        </div>

        <div className="manual-footer">
          <button className="manual-save-btn" onClick={handleSave}>
            确认分配
          </button>
        </div>
      </div>
    </div>
  );
}
