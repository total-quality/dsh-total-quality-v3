/**
 * 质量平台插件 —— Client 半
 * ------------------------------------------------------------------
 * 在左侧栏注册一级入口，在主面板注册整页应用。
 * 应用本体是 Host 半在 /qip-real-v3/ 提供的完整 Web 应用（真实 REST + SSE），
 * 这里用同源 iframe 承载：样式/脚本完全隔离，不与 Harness 抢全局，
 * 应用里的 fetch('/qip-real-v3/api/...')、SSE、文件下载都按浏览器同源正常工作。
 */
window.__ModuleLoader__.load({
  id: 'dsh-total-quality-v3',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const BASE = '/qip-real-v3'

    /**
     * 平台显示名：应用会在启动时把「初始设置」里的公司名称写进 localStorage，
     * 这里同步读取，左侧栏一级入口的标题就跟着公司名称走。
     */
    const DEFAULT_BRAND = '全质开源质量平台2'
    let brandVar = ''
    function brand() {
      if (brandVar) return brandVar
      try {
        const v = window.localStorage && window.localStorage.getItem('qip-real-v3.brand')
        return (v && v.trim()) || DEFAULT_BRAND
      } catch (e) {
        return DEFAULT_BRAND
      }
    }

    const FRAME_STYLE = {
      flex: '1 1 0',
      minHeight: 0,
      width: '100%',
      height: '100%',
      border: '0',
      display: 'block',
      background: '#f2f4f8',
    }

    const HOST_STYLE = {
      flex: '1 1 0',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: '#f2f4f8',
    }

    function QipPage() {
      return h(
        'div',
        { style: HOST_STYLE },
        h('iframe', {
          src: BASE + '/?v=' + Date.now(),
          title: brand(),
          style: FRAME_STYLE,
          allow: 'clipboard-write',
        }),
      )
    }

    function QipIcon() {
      return h('svg', {width:22,height:22,viewBox:'0 0 24 24','aria-label':'全质开源质量平台2'},
        h('rect',{x:1,y:1,width:22,height:22,rx:5,fill:'#fff',stroke:'#d4e3fb'}),
        h('text',{x:12,y:18,textAnchor:'middle',fill:'#2458b3',fontSize:17,fontWeight:700,fontFamily:'Microsoft YaHei,system-ui,sans-serif'},'全'));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 先问一次后端：即便应用页面还没打开过，左侧菜单也能拿到公司名称
        fetch(BASE + '/api/brand')
          .then((r) => r.json())
          .then((d) => {
            if (d && typeof d.brand === 'string' && d.brand.trim()) {
              brandVar = d.brand.trim()
              try { window.localStorage.setItem('qip-real-v3.brand', brandVar) } catch (e) { /* ignore */ }
            }
          })
          .catch(() => {})
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'qip-real-v3' }, QipPage),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'qip-real-v3',
              order: 7,
              label: () => DEFAULT_BRAND,
            },
            QipIcon,
          ),
        )
      },
    }
  },
})


