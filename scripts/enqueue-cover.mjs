const token = process.env.WATCHTOWER_AUTH_TOKEN;
const origin = process.env.WATCHTOWER_ORIGIN ?? "https://watchtower.damao.io";
if (!token) throw new Error("WATCHTOWER_AUTH_TOKEN is required in the environment");

let date = process.argv[2];
if (!date) {
  const latestResponse = await fetch(`${origin}/api/briefs/latest`, { headers: { Accept: "application/json" } });
  if (!latestResponse.ok) throw new Error(`Unable to load latest brief (HTTP ${latestResponse.status})`);
  const latest = await latestResponse.json();
  date = latest.date;
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must use YYYY-MM-DD");
const response = await fetch(`${origin}/api/briefs/${date}/cover/retry`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const payload = await response.json().catch(() => null);
if (!response.ok) throw new Error(`Unable to enqueue cover (HTTP ${response.status}, ${payload?.error?.code ?? "UNKNOWN"})`);
console.log(JSON.stringify(payload));
