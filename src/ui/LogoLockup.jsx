import logo from './assets/kapang-logo.webp'

/**
 * The Kapang lockup. Three sizes, one mark. Never re-typeset the wordmark —
 * it is an image on purpose.
 */
export function LogoLockup({ size = 'md', showPoweredBy = true, className = '' }) {
  return (
    <span className={`k-lockup ${size === 'md' ? '' : size} ${className}`.trim()}>
      {showPoweredBy && <span className="pw">Powered by</span>}
      <a href="https://kapang.com" target="_blank" rel="noopener noreferrer">
        <img src={logo} alt="Kapang" width="200" height="59" />
      </a>
    </span>
  )
}

/** "Watch Live 24/7 on KAPANG.COM" — the channel line. */
export function WatchLine() {
  return <span className="k-watchline">Watch Live 24/7 on <b>KAPANG.COM</b></span>
}

export { logo as kapangLogo }
