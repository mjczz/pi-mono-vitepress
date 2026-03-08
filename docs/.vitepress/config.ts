import { defineConfig } from 'vitepress'
import { withMermaid } from "vitepress-plugin-mermaid";

// https://vitepress.vuejs.org/config/app-configs
const a = defineConfig({
  title: 'pi-mono 深度分析',
  description: '深入理解 pi-mono 核心机制与源码实现',
  base: '/',

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
      { text: '深度分析', link: '/deep-dive/' },
      { text: 'GitHub', link: 'https://github.com/your-org/pi-mono' }
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '首页', link: '/' },
          { text: '文档索引', link: '/deep-dive/' },
          { text: '更新日志', link: '/deep-dive/changelog' },
          { text: '学习路径', link: '/deep-dive/study-tasks' }
        ]
      },
      {
        text: '核心模块',
        items: [
          { text: '概览', link: '/deep-dive/overview' }
        ]
      },
      {
        text: '源码分析',
        items: [
          { text: '项目结构', link: '/deep-dive/project-structure' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-org/pi-mono' }
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
