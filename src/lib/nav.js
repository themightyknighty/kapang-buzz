/**
 * Where a reader can go, as one list.
 *
 * This lived inside the header's JSX, which was fine while the header was on
 * every screen. It is not on every screen: `App` routes the chart, the market
 * and the exchange before the app chrome is built, so four of these six
 * destinations led to a page that no longer offered the nav naming them. The
 * exchange offered nothing at all — its only links were to celebrity pages,
 * and those link back to the board and to the admin panel but never home, so
 * a reader who clicked "Exchange" could reach the rest of the site only with
 * the browser's back button.
 *
 * Both the full header and the slim bar those surfaces now carry read this
 * array, so a destination is added in one place and cannot exist on one
 * surface and not another.
 */
export const NAV = [
  { section: 'home', href: '/', label: 'Stories' },
  { section: 'chart', href: '/chart', label: 'Genie 100', tone: 'chart' },
  { section: 'market', href: '/market', label: 'Market' },
  { section: 'exchange', href: '/exchange', label: 'Exchange' },
  { section: 'quiz', href: '/quiz', label: 'Quiz' },
  { section: 'watch', href: '/watch', label: 'Watch', live: true },
]

/**
 * Which destination a route belongs under.
 *
 * A story and a strand are Stories seen through a filter; a celebrity page is
 * the Market zoomed in; the vertical cut is the Watch channel in another
 * shape. Each is marked as its parent, because "you are here" pointing at
 * nothing is how a reader loses track of where they went.
 */
const SECTIONS = {
  home: 'home',
  story: 'home',
  strand: 'home',
  chart: 'chart',
  market: 'market',
  buzz: 'market',
  exchange: 'exchange',
  quiz: 'quiz',
  watch: 'watch',
  vertical: 'watch',
}

export const sectionOf = (routeName) => SECTIONS[routeName] || null
