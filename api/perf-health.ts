function setCors(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Perf-Schema')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
}

export default function handler(req: any, res: any): void {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' })
    return
  }
  res.status(200).json({ ok: true, service: 'vercel-perf-ingest', now: Date.now() })
}
