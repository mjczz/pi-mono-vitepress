import { defineConfig } from 'vitepress'
import { withMermaid } from "vitepress-plugin-mermaid";

// https://vitepress.vuejs.org/config/app-configs
const a = defineConfig({
  title: 'pi-mono 深度分析',
  description: '深入理解 pi-mono 核心机制与源码实现',
  base: '/',

  // Vite 配置 - 修复 dayjs 导入问题
  vite: {
    optimizeDeps: {
      include: ['dayjs']
    },
    ssr: {
      noExternal: ['dayjs']
    }
  },

  // Markdown 配置
  markdown: {
    // 配置代码块行号
    lineNumbers: true,
    // 配置代码块主题
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '总索引', link: '/deep-dive/pi-mono-study-index' },
      { text: 'GitHub', link: 'https://github.com/badlogic/pi-mono' }
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '首页', link: '/' },
          { text: '总索引', link: '/deep-dive/pi-mono-study-index' },
          { text: '架构图', link: '/deep-dive/pi-mono-architecture-diagram' },
          { text: '更新日志', link: '/deep-dive/changelog' }
        ]
      },
      {
        text: '核心系统分析',
        items: [
          {
            text: 'Extensions 系统',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-01-extensions' }
            ]
          },
          {
            text: '会话管理',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-02-sessions' },
              { text: '深度分析', link: '/deep-dive/pi-mono-analysis-09-sessions-deep' }
            ]
          },
          {
            text: '工具调用系统',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-03-tools' },
              { text: '深度分析', link: '/deep-dive/pi-mono-analysis-10-tools-deep' }
            ]
          },
          {
            text: 'Agent 运行时',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-04-agent-runtime' },
              { text: '深度分析', link: '/deep-dive/pi-mono-analysis-04-agent-runtime-deep' }
            ]
          },
          {
            text: 'TUI 终端 UI',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-05-tui' },
              { text: '深度分析', link: '/deep-dive/pi-mono-analysis-05-tui-deep' }
            ]
          },
          {
            text: '跨提供商切换',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-06-cross-provider' },
              { text: '深度分析', link: '/deep-dive/pi-mono-analysis-06-cross-provider-deep' }
            ]
          },
          {
            text: 'Skills 系统',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-07-skills' },
              { text: '深度分析', link: '/deep-dive/pi-mono-analysis-07-skills-deep' }
            ]
          },
          {
            text: '测试策略',
            items: [
              { text: '快速扫描', link: '/deep-dive/pi-mono-analysis-08-testing' },
              { text: '深度分析', link: '/deep-dive/pi-mono-analysis-08-testing-deep' }
            ]
          }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/badlogic/pi-mono' }
    ],

    footer: {
      message: '基于 CC BY-NC-SA 4.0 许可',
      copyright: 'Copyright © 2026'
    },

    // 搜索配置
    search: {
      provider: 'local'
    }
  }
})

export default withMermaid({
  ...a,
  mermaid: {},
  mermaidPlugin: {
    class: "mermaid my-class",
  },
});
