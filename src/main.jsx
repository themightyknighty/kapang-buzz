import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/bebas-neue/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './ui/tokens.css'
import './ui/kapang-ui.css'
import './ui/share.css'
import './ui/notices.css'
import './brand/genie.css'
import './app.css'
import './vertical.css'
import './market.css'
import './chart.css'
import './ui/movement.css'
import App from './App.jsx'
import { migrateHash } from './lib/useRoute.js'

// Before the first render, not after: an address like `#/story/abc` has to
// become `/story/abc` while nothing has read the route yet, or the app paints
// the front page and then jumps. Every link the app ever put in somebody's
// messages was a fragment, so this stays.
migrateHash()

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
