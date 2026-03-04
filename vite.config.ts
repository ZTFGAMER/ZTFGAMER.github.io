import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { promises as fs } from 'fs'

function debugDefaultsSavePlugin(): Plugin {
  return {
    name: 'debug-defaults-save-plugin',
    configureServer(server) {
      server.middlewares.use('/__debug/save-defaults', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }))
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', async () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8')
            const payload = JSON.parse(raw) as { snapshot?: Record<string, number> }
            const snapshot = payload.snapshot
            if (!snapshot || typeof snapshot !== 'object') throw new Error('invalid_snapshot')

            const targetPath = resolve(__dirname, 'data/debug_defaults.json')
            const text = `${JSON.stringify(snapshot, null, 2)}\n`
            await fs.writeFile(targetPath, text, 'utf-8')

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: true, path: 'data/debug_defaults.json' }))
          } catch (err) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: String(err) }))
          }
        })
      })
    },
  }
}

function copyResourceDirPlugin(): Plugin {
  let outDirAbs = resolve(__dirname, 'dist')
  return {
    name: 'copy-resource-dir-plugin',
    apply: 'build',
    configResolved(config) {
      outDirAbs = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const from = resolve(__dirname, 'resource')
      const to = resolve(outDirAbs, 'resource')
      await fs.cp(from, to, { recursive: true, force: true })
    },
  }
}

export default defineConfig({
  plugins: [debugDefaultsSavePlugin(), copyResourceDirPlugin()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    host: '0.0.0.0', // 局域网手机调试
    port: 5173,
    hmr: {
      host: 'localhost', // 桌面浏览器 HMR 走 localhost，手机调试不受影响
      port: 5173,
    },
  },
})
