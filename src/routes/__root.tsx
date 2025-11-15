/// <reference types="vite/client" />

import * as Solid from 'solid-js'
import { HydrationScript } from 'solid-js/web'
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/solid-router'

import appCss from '#style.css?url'
import xtermCss from '@xterm/xterm/css/xterm.css?url'
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
  shellComponent: RootDocument,
  errorComponent: DefaultCatchBoundary,
  // TODO: better 404 page
  notFoundComponent: () => <section>404</section>,
})

function RootDocument({ children }: { children: Solid.JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <HydrationScript />
      </head>
      <body>
        <HeadContent />
        <Solid.Suspense>{children}</Solid.Suspense>
        <TanStackRouterDevtools position="top-right" />
        <Scripts />
      </body>
    </html>
  )
}
