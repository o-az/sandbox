/// <reference types="vite/client" />

import {
  Outlet,
  Scripts,
  HeadContent,
  createRootRoute,
} from '@tanstack/solid-router'
import * as Solid from 'solid-js'
import { HydrationScript } from 'solid-js/web'

import appCss from '#style.css?url'

import { DevTools } from '#components/dev-tools.tsx'
import xtermCss from '@xterm/xterm/css/xterm.css?url'
import { SessionProvider } from '#context/session.tsx'
import { DefaultCatchBoundary } from '#components/default-catch-boundary.tsx'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charset: 'utf-8' },
      { name: 'description', content: '⌛ 📦' },
      { name: 'keywords', content: 'foundry, web, shell' },
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
    <html lang="en" class="h-full">
      <head>
        <HydrationScript />
      </head>
      <body class="flex h-full min-h-screen flex-col overflow-hidden bg-[#0d1117] font-[Lilex]">
        <HeadContent />
        {children}
        <DevTools />
        <Scripts />
      </body>
    </html>
  )
}
