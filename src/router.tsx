import { createRouter } from '@tanstack/solid-router'

import { routeTree } from '#routeTree.gen.ts'

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
  })

  return router
}
