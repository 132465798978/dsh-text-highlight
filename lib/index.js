/**
 * dsh-text-highlight —— 正文关键词着色 + 字体替换。
 *
 * 这个插件的能力全部在浏览器端（见 lib/client.js）：它往页面里注入一层样式，
 * 再用 CSS Custom Highlight API 给匹配到的关键词 / 整句上色，不碰 React 的
 * DOM 结构，所以流式输出时也不会打架。
 *
 * 服务端这一半只做三件事：声明插件名、接受 cordis.patch.yml 里的配置、把配置
 * 通过 /dsh-text-highlight/config 交给浏览器（浏览器首次加载时拉一次，用户
 * 在面板里改的东西仍然存本地 localStorage）。
 *
 * @module dsh-text-highlight
 */

export const name = 'dsh-text-highlight'

/** 需要 webServer 来暴露配置路由。 */
export const inject = ['webServer']

const ROUTE_PREFIX = '/dsh-text-highlight'

/** 与客户端 lib/client.js 里的 DEFAULT_CONFIG 保持一致。 */
export const DEFAULT_CONFIG = {
  enabled: true,
  fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  fontScope: 'all',
  codeFontFamily: 'Consolas, Cascadia Mono, ui-monospace, monospace',
  rules: [
    { text: '重要', color: '#f5a524', style: 'text' },
    { text: '注意', color: '#f5a524', style: 'text' },
    { text: '结论', color: '#35c2a8', style: 'text' },
    { text: '关键', color: '#35c2a8', style: 'text' },
    { text: '风险', color: '#ef4444', style: 'text' },
    { text: '警告', color: '#ef4444', style: 'text' },
    { text: '建议', color: '#4f8ff7', style: 'text' },
    { text: '推荐', color: '#4f8ff7', style: 'text' },
  ],
  sentenceTriggers: [],
  sentenceColor: '#7c9cff',
  sentenceStyle: 'background',
}

/**
 * 把外部配置收敛成一份合法配置，坏字段直接回默认值。
 * @param {unknown} input
 * @returns {typeof DEFAULT_CONFIG}
 */
export function resolveConfig(input) {
  const config = input !== null && typeof input === 'object' ? input : {}
  const rules = Array.isArray(config.rules)
    ? config.rules
        .filter((rule) => rule && typeof rule.text === 'string' && rule.text.trim() !== '')
        .map((rule) => ({
          text: rule.text.trim(),
          color: typeof rule.color === 'string' && rule.color ? rule.color : '#f5a524',
          style: rule.style === 'background' || rule.style === 'underline' ? rule.style : 'text',
        }))
    : DEFAULT_CONFIG.rules
  return {
    enabled: config.enabled === undefined ? true : Boolean(config.enabled),
    fontFamily:
      typeof config.fontFamily === 'string' && config.fontFamily.trim()
        ? config.fontFamily.trim()
        : DEFAULT_CONFIG.fontFamily,
    fontScope: config.fontScope === 'markdown' ? 'markdown' : 'all',
    codeFontFamily:
      typeof config.codeFontFamily === 'string' && config.codeFontFamily.trim()
        ? config.codeFontFamily.trim()
        : DEFAULT_CONFIG.codeFontFamily,
    rules,
    sentenceTriggers: Array.isArray(config.sentenceTriggers)
      ? config.sentenceTriggers.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
      : [],
    sentenceColor:
      typeof config.sentenceColor === 'string' && config.sentenceColor ? config.sentenceColor : DEFAULT_CONFIG.sentenceColor,
    sentenceStyle:
      config.sentenceStyle === 'text' || config.sentenceStyle === 'underline'
        ? config.sentenceStyle
        : DEFAULT_CONFIG.sentenceStyle,
  }
}

/**
 * 插件入口。
 * @param {object} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (url.pathname === `${ROUTE_PREFIX}/config` && (req.method === 'GET' || req.method === 'HEAD')) {
            const body = JSON.stringify(config)
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(req.method === 'HEAD' ? undefined : body)
            return
          }
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('not found')
        },
      }),
    'dsh-text-highlight: config route',
  )
}

const plugin = { name, inject, apply }
export default plugin
