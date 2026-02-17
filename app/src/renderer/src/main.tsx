import ReactDOM from 'react-dom/client'
import App from './App'
import './app.css'
import { initMastraBaseUrl } from './mastra-client'

// Load persisted server URL before rendering
initMastraBaseUrl().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
})
