/// <reference types="vite/client" />

import {
  Outlet,
  Scripts,
  HeadContent,
  createRootRoute,
  redirect,
} from '@tanstack/solid-router'
import * as Solid from 'solid-js'
import { HydrationScript } from 'solid-js/web'

import appCss from '#style.css?url'
import xtermCss from '@xterm/xterm/css/xterm.css?url'
import { SessionProvider } from '#context/session.tsx'
import { DevTools, useDevTools } from '#components/dev-tools.tsx'
import { DefaultCatchBoundary } from '#components/default-catch-boundary.tsx'

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    // Redirect /?cmd=...&html to /command?cmd=...
    if (location.pathname === '/') {
      const params = new URLSearchParams(location.searchStr)
      const cmd = params.get('cmd')
      const hasHtml = params.has('html')
      if (cmd && hasHtml) {
        throw redirect({
          to: '/command',
          search: { cmd },
        })
      }
    }
  },
  head: () => ({
    meta: [
      { charset: 'utf-8' },
      { name: 'description', content: '⌛ 📦' },
      { name: 'keywords', content: 'code, web, shell' },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1.0, interactive-widget=resizes-content',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'stylesheet', href: xtermCss },
      {
        rel: 'icon',
        href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐚</text></svg>',
      },
    ],
  }),
  component: AppShell,
  shellComponent: RootDocument,
  errorComponent: DefaultCatchBoundary,
  // TODO: better 404 page
  notFoundComponent: () => <section>404</section>,
})

function AppShell() {
  useDevTools()

  return (
    <SessionProvider>
      <Solid.Suspense>
        <Outlet />
      </Solid.Suspense>
    </SessionProvider>
  )
}

function RootDocument({ children }: { children: Solid.JSX.Element }) {
  return (
    <html lang="en" class="h-dvh bg-[#0d1117] overflow-hidden">
      <head>
        <HydrationScript />
        <title>Sandbox</title>
      </head>
      <body class="antialiased flex h-dvh min-h-dvh max-h-dvh flex-col overflow-hidden bg-[#0d1117] font-[Lilex] text-[#c9d1d9]">
        <HeadContent />
        {children}
        <DevTools />
        <Scripts />
      </body>
    </html>
  )
}
