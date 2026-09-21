/**
 * The starting market — about 100 names across the categories.
 *
 * This is a plain list you can edit by hand. Adding or removing a celebrity
 * is one line plus a deploy; ids are generated from the name once and must
 * never change afterwards, because every future table (holdings, watchlists,
 * predictions) will key off them.
 *
 * Alias strengths are a judgement call and are deliberately hand-written
 * rather than pulled from Wikidata's "also known as", which is noisy.
 * `excludes` kills known collisions and grows as false positives turn up.
 *
 * Images are not listed here: they are resolved at ingestion from Wikimedia
 * Commons under a free licence only, with the credit stored alongside.
 *
 * Note: no political figures. The app's safety gates exclude politics
 * throughout, and the market follows the same rule.
 */
import { makeCelebrity } from './celebrities.mjs'

const SEED = [
  /* ---------------- Film ---------------- */
  { name: 'Timothée Chalamet', cat: 'film', page: 'Timothée_Chalamet', aliases: [['Chalamet', 'strong']] },
  { name: 'Zendaya', cat: 'film', page: 'Zendaya', also: ['tv'] },
  { name: 'Pedro Pascal', cat: 'film', page: 'Pedro_Pascal', also: ['tv'], country: 'CL',
    aliases: [['Pascal', 'ambiguous', ['pedro', 'last of us', 'mandalorian', 'gladiator']]],
    excludes: ['pascal programming', 'blaise pascal', 'pascal case', 'kilopascal'] },
  { name: 'Margot Robbie', cat: 'film', page: 'Margot_Robbie', country: 'AU', aliases: [['Robbie', 'ambiguous', ['margot', 'barbie']]] },
  { name: 'Ryan Gosling', cat: 'film', page: 'Ryan_Gosling', country: 'CA', aliases: [['Gosling', 'strong']] },
  { name: 'Emma Stone', cat: 'film', page: 'Emma_Stone' },
  { name: 'Florence Pugh', cat: 'film', page: 'Florence_Pugh', country: 'GB', aliases: [['Pugh', 'strong']] },
  { name: 'Austin Butler', cat: 'film', page: 'Austin_Butler', aliases: [['Butler', 'ambiguous', ['austin', 'elvis', 'dune']]] },
  { name: 'Anya Taylor-Joy', cat: 'film', page: 'Anya_Taylor-Joy', aliases: [['Taylor-Joy', 'strong']] },
  { name: 'Tom Holland', cat: 'film', page: 'Tom_Holland_(actor)', country: 'GB', aliases: [['Holland', 'ambiguous', ['tom', 'spider-man', 'spiderman']]] },
  { name: 'Dwayne Johnson', cat: 'film', page: 'Dwayne_Johnson', also: ['sport'],
    aliases: [['The Rock', 'strong'], ['Johnson', 'ambiguous', ['dwayne', 'the rock', 'moana', 'wrestler']]],
    excludes: ['boris johnson', 'johnson & johnson', 'johnson controls'] },
  { name: 'Denzel Washington', cat: 'film', page: 'Denzel_Washington', aliases: [['Denzel', 'strong']] },
  { name: 'Cillian Murphy', cat: 'film', page: 'Cillian_Murphy', country: 'IE', aliases: [['Cillian', 'strong']] },
  { name: 'Sydney Sweeney', cat: 'film', page: 'Sydney_Sweeney', also: ['tv'], aliases: [['Sweeney', 'ambiguous', ['sydney', 'euphoria', 'anyone but you']]] },
  { name: 'Jacob Elordi', cat: 'film', page: 'Jacob_Elordi', country: 'AU', aliases: [['Elordi', 'strong']] },
  { name: 'Michelle Yeoh', cat: 'film', page: 'Michelle_Yeoh', country: 'MY', aliases: [['Yeoh', 'strong']] },
  { name: 'Glen Powell', cat: 'film', page: 'Glen_Powell', aliases: [['Powell', 'ambiguous', ['glen', 'top gun', 'twisters']]] },
  { name: 'Ana de Armas', cat: 'film', page: 'Ana_de_Armas', country: 'CU', aliases: [['de Armas', 'strong']] },

  /* ---------------- Television ---------------- */
  { name: 'Jenna Ortega', cat: 'tv', page: 'Jenna_Ortega', also: ['film'], aliases: [['Ortega', 'ambiguous', ['jenna', 'wednesday', 'addams']]] },
  { name: 'Millie Bobby Brown', cat: 'tv', page: 'Millie_Bobby_Brown', country: 'GB', aliases: [['Millie Bobby', 'strong']] },
  { name: 'Bella Ramsey', cat: 'tv', page: 'Bella_Ramsey', country: 'GB', aliases: [['Ramsey', 'ambiguous', ['bella', 'last of us', 'ellie']]] },
  { name: 'Kieran Culkin', cat: 'tv', page: 'Kieran_Culkin', also: ['film'], aliases: [['Culkin', 'ambiguous', ['kieran', 'succession', 'roman']]] },
  { name: 'Sarah Snook', cat: 'tv', page: 'Sarah_Snook', country: 'AU', aliases: [['Snook', 'strong']] },
  { name: 'Jeremy Allen White', cat: 'tv', page: 'Jeremy_Allen_White', aliases: [['Allen White', 'strong']] },
  { name: 'Ayo Edebiri', cat: 'tv', page: 'Ayo_Edebiri', also: ['comedy'], aliases: [['Edebiri', 'strong']] },
  { name: 'Elizabeth Olsen', cat: 'tv', page: 'Elizabeth_Olsen', also: ['film'], aliases: [['Olsen', 'ambiguous', ['elizabeth', 'wanda', 'scarlet witch']]] },
  { name: 'Aubrey Plaza', cat: 'tv', page: 'Aubrey_Plaza', also: ['comedy'], aliases: [['Plaza', 'ambiguous', ['aubrey', 'white lotus', 'parks and rec']]] },
  { name: 'Nicola Coughlan', cat: 'tv', page: 'Nicola_Coughlan', country: 'IE', aliases: [['Coughlan', 'strong']] },
  { name: 'Simone Ashley', cat: 'tv', page: 'Simone_Ashley', country: 'GB', aliases: [['Ashley', 'ambiguous', ['simone', 'bridgerton']]] },
  { name: 'Emma Corrin', cat: 'tv', page: 'Emma_Corrin', country: 'GB', aliases: [['Corrin', 'strong']] },
  { name: 'Walton Goggins', cat: 'tv', page: 'Walton_Goggins', aliases: [['Goggins', 'strong']] },

  /* ---------------- Music ---------------- */
  { name: 'Taylor Swift', cat: 'music', page: 'Taylor_Swift',
    aliases: [['Swift', 'ambiguous', ['taylor', 'eras', 'album', 'singer', 'swifties']]],
    excludes: ['swift bird', 'swift code', 'apple swift', 'swift programming', 'chimney swift', 'jonathan swift'] },
  { name: 'Beyoncé', cat: 'music', page: 'Beyoncé', aliases: [['Beyonce', 'unique'], ['Queen Bey', 'strong']] },
  { name: 'Harry Styles', cat: 'music', page: 'Harry_Styles', country: 'GB', aliases: [['Styles', 'ambiguous', ['harry', 'one direction', 'singer']]] },
  { name: 'Olivia Rodrigo', cat: 'music', page: 'Olivia_Rodrigo', aliases: [['Rodrigo', 'ambiguous', ['olivia', 'guts', 'sour', 'singer']]] },
  { name: 'Billie Eilish', cat: 'music', page: 'Billie_Eilish', aliases: [['Eilish', 'strong']] },
  { name: 'Dua Lipa', cat: 'music', page: 'Dua_Lipa', country: 'GB', aliases: [['Dua', 'strong']] },
  { name: 'Sabrina Carpenter', cat: 'music', page: 'Sabrina_Carpenter', aliases: [['Carpenter', 'ambiguous', ['sabrina', 'espresso', 'short n sweet', 'singer']]] },
  { name: 'Chappell Roan', cat: 'music', page: 'Chappell_Roan', aliases: [['Chappell', 'strong']] },
  { name: 'Bad Bunny', cat: 'music', page: 'Bad_Bunny', country: 'PR', aliases: [['Benito Martínez Ocasio', 'unique']] },
  { name: 'Rosalía', cat: 'music', page: 'Rosalía', country: 'ES', aliases: [['Rosalia', 'unique']] },
  { name: 'Doja Cat', cat: 'music', page: 'Doja_Cat', aliases: [['Doja', 'strong']] },
  { name: 'SZA', cat: 'music', page: 'SZA', aliases: [['Solána Rowe', 'unique']] },
  { name: 'Ariana Grande', cat: 'music', page: 'Ariana_Grande', also: ['film'], aliases: [['Ariana', 'strong']] },
  { name: 'Adele', cat: 'music', page: 'Adele', country: 'GB' },
  { name: 'Ed Sheeran', cat: 'music', page: 'Ed_Sheeran', country: 'GB', aliases: [['Sheeran', 'strong']] },
  { name: 'Drake', cat: 'music', page: 'Drake_(musician)', country: 'CA',
    aliases: [['Aubrey Graham', 'unique']], excludes: ['drake equation', 'sir francis drake', 'drake passage', 'drake university'] },
  { name: 'Kendrick Lamar', cat: 'music', page: 'Kendrick_Lamar', aliases: [['Kendrick', 'strong']] },
  { name: 'The Weeknd', cat: 'music', page: 'The_Weeknd', country: 'CA', aliases: [['Abel Tesfaye', 'unique']] },
  { name: 'Lady Gaga', cat: 'music', page: 'Lady_Gaga', also: ['film'], aliases: [['Gaga', 'strong']] },
  { name: 'Bruno Mars', cat: 'music', page: 'Bruno_Mars', aliases: [['Bruno', 'ambiguous', ['mars', 'singer', 'apt', 'grammy']]] },
  { name: 'Rihanna', cat: 'music', page: 'Rihanna', also: ['fashion', 'business'], country: 'BB', aliases: [['Fenty', 'strong']] },
  { name: 'Post Malone', cat: 'music', page: 'Post_Malone', aliases: [['Posty', 'strong']] },

  /* ---------------- Reality ---------------- */
  { name: 'Kim Kardashian', cat: 'reality', page: 'Kim_Kardashian', also: ['business', 'fashion'], aliases: [['Kim K', 'strong']] },
  { name: 'Kylie Jenner', cat: 'reality', page: 'Kylie_Jenner', also: ['business'], aliases: [['Kylie', 'ambiguous', ['jenner', 'kardashian', 'kylie cosmetics']]] },
  { name: 'Kendall Jenner', cat: 'reality', page: 'Kendall_Jenner', also: ['fashion'], aliases: [['Kendall', 'ambiguous', ['jenner', 'kardashian', 'model']]] },
  { name: 'Khloé Kardashian', cat: 'reality', page: 'Khloé_Kardashian', aliases: [['Khloe Kardashian', 'unique']] },
  { name: 'Kourtney Kardashian', cat: 'reality', page: 'Kourtney_Kardashian' },
  { name: 'Paris Hilton', cat: 'reality', page: 'Paris_Hilton', also: ['business'], aliases: [['Hilton', 'ambiguous', ['paris', 'heiress', 'dj']]], excludes: ['hilton hotel', 'hilton head'] },
  { name: 'Lisa Vanderpump', cat: 'reality', page: 'Lisa_Vanderpump', country: 'GB', aliases: [['Vanderpump', 'strong']] },
  { name: 'Bethenny Frankel', cat: 'reality', page: 'Bethenny_Frankel', aliases: [['Bethenny', 'strong']] },

  /* ---------------- Sport ---------------- */
  { name: 'Lionel Messi', cat: 'sport', page: 'Lionel_Messi', country: 'AR', aliases: [['Messi', 'strong']] },
  { name: 'Cristiano Ronaldo', cat: 'sport', page: 'Cristiano_Ronaldo', country: 'PT', aliases: [['Ronaldo', 'ambiguous', ['cristiano', 'al nassr', 'portugal']]] },
  { name: 'Simone Biles', cat: 'sport', page: 'Simone_Biles', aliases: [['Biles', 'strong']] },
  { name: 'Serena Williams', cat: 'sport', page: 'Serena_Williams', aliases: [['Serena', 'strong']] },
  { name: 'LeBron James', cat: 'sport', page: 'LeBron_James', aliases: [['LeBron', 'strong']] },
  { name: 'Caitlin Clark', cat: 'sport', page: 'Caitlin_Clark', aliases: [['Clark', 'ambiguous', ['caitlin', 'fever', 'wnba', 'indiana']]] },
  { name: 'Travis Kelce', cat: 'sport', page: 'Travis_Kelce', aliases: [['Kelce', 'ambiguous', ['travis', 'chiefs', 'tight end']]] },
  { name: 'Patrick Mahomes', cat: 'sport', page: 'Patrick_Mahomes', aliases: [['Mahomes', 'strong']] },
  { name: 'Coco Gauff', cat: 'sport', page: 'Coco_Gauff', aliases: [['Gauff', 'strong']] },
  { name: 'Carlos Alcaraz', cat: 'sport', page: 'Carlos_Alcaraz', country: 'ES', aliases: [['Alcaraz', 'strong']] },
  { name: 'Erling Haaland', cat: 'sport', page: 'Erling_Haaland', country: 'NO', aliases: [['Haaland', 'strong']] },
  { name: 'Shohei Ohtani', cat: 'sport', page: 'Shohei_Ohtani', country: 'JP', aliases: [['Ohtani', 'strong']] },

  /* ---------------- Creators ---------------- */
  { name: 'MrBeast', cat: 'creators', page: 'MrBeast', aliases: [['Jimmy Donaldson', 'unique'], ['Mr Beast', 'unique']] },
  { name: 'Charli D\'Amelio', cat: 'creators', page: 'Charli_D\'Amelio', aliases: [['D\'Amelio', 'strong']] },
  { name: 'Addison Rae', cat: 'creators', page: 'Addison_Rae', also: ['music'], aliases: [['Addison', 'ambiguous', ['rae', 'tiktok', 'singer']]] },
  { name: 'Emma Chamberlain', cat: 'creators', page: 'Emma_Chamberlain', aliases: [['Chamberlain', 'ambiguous', ['emma', 'youtube', 'chamberlain coffee']]] },
  { name: 'Khaby Lame', cat: 'creators', page: 'Khaby_Lame', country: 'IT', aliases: [['Khaby', 'strong']] },
  { name: 'Logan Paul', cat: 'creators', page: 'Logan_Paul', also: ['sport'], aliases: [['Logan', 'ambiguous', ['paul', 'prime', 'wwe', 'youtube']]] },
  { name: 'Jake Paul', cat: 'creators', page: 'Jake_Paul', also: ['sport'], aliases: [['Jake', 'ambiguous', ['paul', 'boxing', 'youtube']]] },
  { name: 'Bretman Rock', cat: 'creators', page: 'Bretman_Rock', aliases: [['Bretman', 'strong']] },

  /* ---------------- Fashion ---------------- */
  { name: 'Gigi Hadid', cat: 'fashion', page: 'Gigi_Hadid', aliases: [['Gigi', 'ambiguous', ['hadid', 'model', 'runway']]] },
  { name: 'Bella Hadid', cat: 'fashion', page: 'Bella_Hadid', aliases: [['Bella', 'ambiguous', ['hadid', 'model', 'runway']]] },
  { name: 'Naomi Campbell', cat: 'fashion', page: 'Naomi_Campbell', country: 'GB', aliases: [['Campbell', 'ambiguous', ['naomi', 'supermodel', 'runway']]] },
  { name: 'Anna Wintour', cat: 'fashion', page: 'Anna_Wintour', country: 'GB', aliases: [['Wintour', 'strong']] },
  { name: 'Hailey Bieber', cat: 'fashion', page: 'Hailey_Bieber', also: ['business'], aliases: [['Rhode', 'ambiguous', ['hailey', 'bieber', 'skincare']]] },
  { name: 'Cara Delevingne', cat: 'fashion', page: 'Cara_Delevingne', country: 'GB', aliases: [['Delevingne', 'strong']] },

  /* ---------------- Royalty ---------------- */
  { name: 'Catherine, Princess of Wales', cat: 'royalty', page: 'Catherine,_Princess_of_Wales', country: 'GB',
    aliases: [['Kate Middleton', 'unique'], ['Princess of Wales', 'strong']] },
  { name: 'William, Prince of Wales', cat: 'royalty', page: 'William,_Prince_of_Wales', country: 'GB',
    aliases: [['Prince William', 'unique']] },
  { name: 'Prince Harry', cat: 'royalty', page: 'Prince_Harry,_Duke_of_Sussex', country: 'GB',
    aliases: [['Duke of Sussex', 'strong']] },
  { name: 'Meghan, Duchess of Sussex', cat: 'royalty', page: 'Meghan,_Duchess_of_Sussex',
    aliases: [['Meghan Markle', 'unique'], ['Duchess of Sussex', 'strong']] },
  { name: 'King Charles III', cat: 'royalty', page: 'Charles_III', country: 'GB', aliases: [['Charles III', 'unique']] },
  { name: 'Queen Camilla', cat: 'royalty', page: 'Camilla,_Queen_of_the_United_Kingdom', country: 'GB' },

  /* ---------------- Comedy ---------------- */
  { name: 'Pete Davidson', cat: 'comedy', page: 'Pete_Davidson', aliases: [['Davidson', 'ambiguous', ['pete', 'snl', 'comedian']]] },
  { name: 'Ali Wong', cat: 'comedy', page: 'Ali_Wong', aliases: [['Wong', 'ambiguous', ['ali', 'comedian', 'beef']]] },
  { name: 'John Mulaney', cat: 'comedy', page: 'John_Mulaney', aliases: [['Mulaney', 'strong']] },
  { name: 'Bowen Yang', cat: 'comedy', page: 'Bowen_Yang', aliases: [['Bowen', 'strong']] },
  { name: 'Tina Fey', cat: 'comedy', page: 'Tina_Fey', also: ['tv'], aliases: [['Fey', 'strong']] },
  { name: 'Amy Poehler', cat: 'comedy', page: 'Amy_Poehler', also: ['tv'], aliases: [['Poehler', 'strong']] },
  { name: 'Kevin Hart', cat: 'comedy', page: 'Kevin_Hart', also: ['film'], aliases: [['Hart', 'ambiguous', ['kevin', 'comedian']]] },

  /* ---------------- Business ---------------- */
  { name: 'Oprah Winfrey', cat: 'business', page: 'Oprah_Winfrey', also: ['tv'], aliases: [['Oprah', 'unique']] },
  { name: 'Martha Stewart', cat: 'business', page: 'Martha_Stewart', also: ['tv'], aliases: [['Martha', 'ambiguous', ['stewart', 'lifestyle', 'recipe']]] },
  { name: 'Mark Cuban', cat: 'business', page: 'Mark_Cuban', also: ['tv'], aliases: [['Cuban', 'ambiguous', ['mark', 'shark tank', 'mavericks']]] },
  { name: 'Richard Branson', cat: 'business', page: 'Richard_Branson', country: 'GB', aliases: [['Branson', 'strong']] },
  { name: 'Ryan Reynolds', cat: 'business', page: 'Ryan_Reynolds', also: ['film'], country: 'CA', aliases: [['Reynolds', 'ambiguous', ['ryan', 'deadpool', 'aviation gin', 'wrexham']]] },
]

export const ROSTER = SEED.map((s) => makeCelebrity(s))
export const byId = (id) => ROSTER.find((c) => c.id === id) || null
export const bySlug = (slug) => ROSTER.find((c) => c.slug === slug) || null
export const activeRoster = () => ROSTER.filter((c) => c.active)
export default ROSTER
