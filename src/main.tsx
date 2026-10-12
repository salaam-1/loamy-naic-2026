import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import '@/index.css'

async function bootstrap() {
  if (import.meta.env.VITE_LOAM_STT_ENABLED === 'true') {
    const { enableModalYorubaStt } = await import('@/lib/providers/stt-modal')
    enableModalYorubaStt()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()