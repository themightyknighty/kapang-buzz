import { useEffect } from 'react'
import { useFeed, isStale } from './lib/useFeed.js'
import { useRoute, navigate } from './lib/useRoute.js'
import { sectionOf } from './lib/nav.js'
import { Header, Footer } from './components.jsx'
import Home from './screens/Home.jsx'
import Story from './screens/Story.jsx'
import Quiz from './screens/Quiz.jsx'
import Watch from './screens/Watch.jsx'
import Market from './screens/Market.jsx'
import Chart from './screens/Chart.jsx'
import Exchange from './screens/Exchange.jsx'
import CelebrityDetail from './screens/CelebrityDetail.jsx'
import MarketAdmin from './screens/MarketAdmin.jsx'
import { useMarket } from './lib/useMarket.js'
import { ago } from './lib/time.js'

export default function App() {
  const { feed } = useFeed()
  // The market is loaded once, here, because it is no longer only the market
  // screen's data: the front page and the Watch screen both lead with who is
  // rising and falling. One poller, shared by every surface.
  const { market } = useMarket()
  const route = useRoute()

  // The Buzz Board was the old answer to "who is hot" — Wikipedia lookups from
  // the day before. The market answers it better and hourly, so the old links
  // land there rather than on two boards that can disagree.
  useEffect(() => {
    if (route.name === 'buzz') navigate('/market', { replace: true })
  }, [route.name])

  // The market is its own full-screen surface with its own refresh cadence, so
  // it is routed before the news app's chrome is built.
  if (route.name === 'market') return <MarketRoute arg={route.arg} market={market} feed={feed} />

  // The chart is its own surface: one week, held still, with no app chrome
  // around it. It is the page most shared links point at.
  if (route.name === 'chart') return <Chart weekId={route.arg} />
  if (route.name === 'exchange') return <Exchange />

  if (route.name === 'watch') return <Watch feed={feed} market={market} />
  if (route.name === 'vertical') return <Watch feed={feed} market={market} format="9x16" />

  let screen = null
  if (!feed) screen = <div className="b-wrap b-loading">Loading today’s stories…</div>
  else if (route.name === 'story') screen = <Story feed={feed} id={route.arg} />
  else if (route.name === 'buzz') screen = <div className="b-wrap b-loading">Taking you to the Celebrity Market…</div>
  else if (route.name === 'quiz') screen = <Quiz feed={feed} />
  else screen = <Home feed={feed} strand={route.name === 'strand' ? route.arg : null} />

  return (
    <div className="b-app">
      <Header feed={feed} market={market} current={sectionOf(route.name)} />
      {isStale(feed) && (
        <div className="b-stale">Stories last updated {ago(feed.generatedAt)} — the next update is running late.</div>
      )}
      <main>{screen}</main>
      <Footer />
    </div>
  )
}

/**
 * /market, /market/<slug>, /market/admin
 *
 * The feed goes in as well as the market, because a mover's reason comes from
 * our published stories. Without it the market can say a name is rising but
 * not why, which is the half of the answer nobody wants.
 */
function MarketRoute({ arg, market, feed }) {
  if (arg === 'admin') return <MarketAdmin market={market} />
  if (arg) return <CelebrityDetail market={market} feed={feed} slug={arg} />
  return <Market market={market} feed={feed} />
}
