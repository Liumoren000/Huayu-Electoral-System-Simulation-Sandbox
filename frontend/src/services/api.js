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

export async function runGovernment(request) {
  const res = await fetch(`${API_BASE}/simulate/government`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Government simulation failed');
  return res.json();
}

export async function runSystemComparison(request) {
  const res = await fetch(`${API_BASE}/simulate/system-comparison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('System comparison failed');
  return res.json();
}

export async function runSwingometer(request) {
  const res = await fetch(`${API_BASE}/simulate/swingometer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Swingometer failed');
  return res.json();
}

export async function runWastedVotes(request) {
  const res = await fetch(`${API_BASE}/simulate/wasted-votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Wasted votes analysis failed');
  return res.json();
}

export async function runRepresentationGap(request) {
  const res = await fetch(`${API_BASE}/simulate/representation-gap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Representation gap analysis failed');
  return res.json();
}

export async function runPartySpace(request) {
  const res = await fetch(`${API_BASE}/simulate/party-space`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Party space competition failed');
  return res.json();
}

export async function runIssueOwnership(request) {
  const res = await fetch(`${API_BASE}/simulate/issue-ownership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Issue ownership analysis failed');
  return res.json();
}

export async function runDistrictMagnitude(request) {
  const res = await fetch(`${API_BASE}/simulate/district-magnitude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('District magnitude analysis failed');
  return res.json();
}

export async function runPartyFreeze(request) {
  const res = await fetch(`${API_BASE}/simulate/party-freeze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Party system freeze analysis failed');
  return res.json();
}
