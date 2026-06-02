import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
    },
    server: {
        port: 8080,
        host: '0.0.0.0',   // 监听所有网卡，允许 LAN 访问
        strictPort: true,
        allowedHosts: [
            '.ngrok-free.app', '.ngrok-free.dev',
            '.ngrok.io', '.ngrok.app', '.ngrok.dev',
            '.trycloudflare.com',           // Cloudflare Tunnel 临时域名
            '.loca.lt',                      // localtunnel
            '.serveo.net',                   // serveo
        ],
    }
});
