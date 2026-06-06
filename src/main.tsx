import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// Register tree-sitter wasm asset URLs for the renderer (side effect).
import './services/treesitter-wasm-web'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
