export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export async function fetchParties() {
  const res = await fetch(`${API_BASE}/parties`);
  if (!res.ok) throw new Error('Failed to fetch parties');
  return res.json();
}

export async function fetchEras() {
  const res = await fetch(`${API_BASE}/eras`);
  if (!res.ok) throw new Error('Failed to fetch eras');
  return res.json();
}

export async function fetchCities(year = 2023) {
  const res = await fetch(`${API_BASE}/cities?year=${year}`);
  if (!res.ok) throw new Error('Failed to fetch cities');
  return res.json();
}

export async function runSimulation(request) {
  const res = await fetch(`${API_BASE}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Simulation failed');
  return res.json();
}

export async function runRobustness(request) {
  const res = await fetch(`${API_BASE}/simulate/robustness`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Robustness analysis failed');
  return res.json();
}

export async function runSensitivity(request) {
  const res = await fetch(`${API_BASE}/simulate/sensitivity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Sensitivity analysis failed');
  return res.json();
}

export async function explainVoterModel(request) {
  const res = await fetch(`${API_BASE}/voter-model/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Voter model explanation failed');
  return res.json();
}

export async function fetchVoterStructure(request) {
  const res = await fetch(`${API_BASE}/voter-model/structure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Voter structure analysis failed');
  return res.json();
}

export async function runPoll(request) {
  const res = await fetch(`${API_BASE}/simulate/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Poll simulation failed');
  return res.json();
}

export async function runSwingAnalysis(request) {
  const res = await fetch(`${API_BASE}/simulate/swing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Swing analysis failed');
  return res.json();
}

export async function runCalibration(request) {
  const res = await fetch(`${API_BASE}/simulate/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Calibration failed');
  return res.json();
}
