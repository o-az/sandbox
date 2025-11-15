import { render } from 'preact'

import './style.css'

export function App() {
  return (
    <main>
      <h1>
        Get Started building <strong>Lorem Ipsum</strong>
      </h1>
      <section className="demo-section">
        <iframe
          src={
            'https://sandbox.evm.workers.dev?' +
            new URLSearchParams({
              embed: 'true',
              autorun: 'true',
              cmd: 'bun x cowsay "Ad ullamco dolore dolor dolor dolor in cupidatat do id eu ut non aliquip eu."',
            }).toString()
          }
          title="Sandbox Demo"
          width="100%"
          height="100%"
          className="demo-iframe"
        />
      </section>
      <footer>
        <a
          href="https://github.com/o-az/foundry-sandbox"
          target="_blank"
          rel="noopener noreferrer">
          github.com/o-az/foundry-sandbox
        </a>
      </footer>
    </main>
  )
}

render(<App />, document.querySelector('div#app'))
