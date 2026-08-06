const API_BASE = '/api';

export async function fetchParties() {
  const res = await fetch(`${API_BASE}/parties`);
  if (!res.ok) throw new Error('Failed to fetch parties');
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
