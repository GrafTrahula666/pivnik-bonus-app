export const RAILWAY_PRODUCTION = Object.freeze({
  projectId: '20a942f9-3164-484a-a6f1-565439e38705',
  environmentId: 'cdd9d26c-2aab-45d9-95ed-ef487fafaa8f',
  services: Object.freeze({
    telegram: 'd8d26f64-9ac1-4a03-9036-1a60f43c0be6',
    vk: '0573c420-0f9c-43bd-8e87-e1788ce3eefd',
    postgres: '4f0c39c3-cd84-4f41-a97e-c95b342653c4'
  }),
  urls: Object.freeze({
    telegram: 'https://pivnik-bonus-app-production-df60.up.railway.app',
    vk: 'https://pivnik-vk-test-production-3474.up.railway.app',
    vkProxy: 'https://pivnik-vk-proxy.vercel.app',
    vkLaunch: 'https://pivnik-vk-proxy.vercel.app/vk'
  })
});

export function productionUrl(platform, override = '') {
  return String(override || RAILWAY_PRODUCTION.urls[platform] || '').trim().replace(/\/+$/, '');
}
