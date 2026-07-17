const token = process.env.WATCHTOWER_FEEDBACK_TOKEN;
const origin = process.env.WATCHTOWER_ORIGIN ?? "https://watchtower.damao.io";
if (!token) throw new Error("WATCHTOWER_FEEDBACK_TOKEN is required in .env");

let date = process.argv[2];
if (!date) {
  const latestResponse = await fetch(`${origin}/api/briefs/latest`, { headers: { Accept: "application/json" } });
  if (!latestResponse.ok) throw new Error(`Unable to load latest brief (HTTP ${latestResponse.status})`);
  const latest = await latestResponse.json();
  date = latest.date;
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must use YYYY-MM-DD");
const response = await fetch(`${origin}/api/admin/brief-cover/${date}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const payload = await response.json().catch(() => null);
if (!response.ok) throw new Error(`Unable to enqueue cover (HTTP ${response.status}, ${payload?.error?.code ?? "UNKNOWN"})`);
console.log(JSON.stringify(payload));
